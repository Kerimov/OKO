use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageMeta {
  pub format_version: u32,
  pub zid: i64,
  pub eid: i64,
  pub organization: String,
  pub period_start: String,
  pub period_end: String,
  #[serde(default)]
  pub enterprise_code: Option<String>,
  #[serde(default)]
  pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPackageResult {
  pub folder_path: String,
  pub meta: PackageMeta,
  pub db_path: String,
  pub instances: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceSummary {
  pub instance_id: String,
  pub template_id: String,
  pub template_title: String,
  pub display_name: String,
  pub organization: String,
  pub period_start: String,
  pub period_end: String,
  pub zid: Option<i64>,
  pub eid: Option<i64>,
  pub status: String,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormMeta {
  pub organization: String,
  pub enterprise_code: String,
  pub period_start: String,
  pub period_end: String,
  pub unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OkoFormInstance {
  pub instance_id: String,
  pub template_id: String,
  pub template_title: String,
  pub display_name: String,
  #[serde(default)]
  pub zid: Option<i64>,
  #[serde(default)]
  pub eid: Option<i64>,
  #[serde(default)]
  pub status: Option<String>,
  pub meta: FormMeta,
  pub rows: Vec<Map<String, Value>>,
  pub signatures: Map<String, Value>,
  #[serde(default)]
  pub rash_entries: Option<Value>,
  pub created_at: String,
  pub updated_at: String,
}

struct PackageState {
  folder: PathBuf,
  db_path: PathBuf,
  meta: PackageMeta,
  conn: Connection,
}

struct AppState {
  package: Mutex<Option<PackageState>>,
}

#[derive(Debug, thiserror::Error)]
enum AppError {
  #[error("{0}")]
  Message(String),
}

impl Serialize for AppError {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: serde::Serializer,
  {
    serializer.serialize_str(&self.to_string())
  }
}

fn read_meta(folder: &Path) -> Result<PackageMeta, AppError> {
  let meta_path = folder.join("package.meta.json");
  if !meta_path.exists() {
    return Err(AppError::Message(
      "В папке нет package.meta.json — это не комплект ОКО".into(),
    ));
  }
  let raw = fs::read_to_string(&meta_path)
    .map_err(|e| AppError::Message(format!("Не удалось прочитать package.meta.json: {e}")))?;
  serde_json::from_str(&raw)
    .map_err(|e| AppError::Message(format!("Некорректный package.meta.json: {e}")))
}

fn open_db(db_path: &Path) -> Result<Connection, AppError> {
  if !db_path.exists() {
    return Err(AppError::Message(
      "В папке нет oko.db — откройте комплект, созданный десктопом".into(),
    ));
  }
  let conn = Connection::open(db_path)
    .map_err(|e| AppError::Message(format!("SQLite open failed: {e}")))?;
  conn
    .execute_batch(
      "PRAGMA journal_mode = WAL;
       PRAGMA busy_timeout = 5000;
       PRAGMA foreign_keys = ON;",
    )
    .map_err(|e| AppError::Message(format!("PRAGMA failed: {e}")))?;

  // Soft migrate columns used by Electron filler
  let _ = conn.execute(
    "ALTER TABLE form_instances ADD COLUMN rash_entries_json TEXT DEFAULT '[]'",
    [],
  );
  let _ = conn.execute("ALTER TABLE form_cell_values ADD COLUMN updated_at TEXT", []);
  let _ = conn.execute("ALTER TABLE form_cell_values ADD COLUMN updated_by TEXT", []);
  let _ = conn.execute(
    "ALTER TABLE form_cell_values ADD COLUMN updated_client_id TEXT",
    [],
  );

  Ok(conn)
}

fn count_instances(conn: &Connection) -> Result<usize, AppError> {
  let exists: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='form_instances'",
      [],
      |row| row.get(0),
    )
    .unwrap_or(0);
  if exists == 0 {
    return Ok(0);
  }
  let n: i64 = conn
    .query_row("SELECT COUNT(*) FROM form_instances", [], |row| row.get(0))
    .map_err(|e| AppError::Message(format!("COUNT form_instances failed: {e}")))?;
  Ok(n as usize)
}

fn with_package<T>(
  state: &State<'_, AppState>,
  f: impl FnOnce(&mut PackageState) -> Result<T, AppError>,
) -> Result<T, AppError> {
  let mut guard = state
    .package
    .lock()
    .map_err(|_| AppError::Message("state lock poisoned".into()))?;
  let pkg = guard
    .as_mut()
    .ok_or_else(|| AppError::Message("Комплект не открыт".into()))?;
  f(pkg)
}

fn resolve_row_no(row: &Map<String, Value>, index: usize) -> i64 {
  if let Some(num) = row.get("num") {
    let s = match num {
      Value::String(s) => s.trim().to_string(),
      Value::Number(n) => n.to_string(),
      _ => String::new(),
    };
    if let Ok(parsed) = s.parse::<i64>() {
      if parsed != 0 {
        return parsed;
      }
    }
  }
  900_000_000 + index as i64
}

fn cell_value_parts(val: &Value) -> (Option<f64>, Option<String>) {
  match val {
    Value::Null => (None, None),
    Value::String(s) if s.trim().is_empty() => (None, None),
    Value::Number(n) => (n.as_f64(), None),
    Value::String(s) => {
      let cleaned = s.replace(' ', "").replace(',', ".");
      if let Ok(n) = cleaned.parse::<f64>() {
        if s.trim().chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | ',' | '-' | ' ')) {
          return (Some(n), None);
        }
      }
      (None, Some(s.clone()))
    }
    other => (None, Some(other.to_string())),
  }
}

fn read_cell_value(value_num: Option<f64>, value_text: Option<String>) -> Value {
  if let Some(t) = value_text {
    if !t.is_empty() {
      return Value::String(t);
    }
  }
  if let Some(n) = value_num {
    return Value::from(n);
  }
  Value::String(String::new())
}

fn rows_from_cells(
  cells: Vec<(i64, Option<String>, String, Option<f64>, Option<String>)>,
) -> Vec<Map<String, Value>> {
  let mut by_row: BTreeMap<i64, (Map<String, Value>, Option<String>, Option<f64>)> = BTreeMap::new();

  for (row_no, row_name, column_key, value_num, value_text) in cells {
    let entry = by_row
      .entry(row_no)
      .or_insert_with(|| (Map::new(), row_name.clone(), None));
    if column_key == "_row_index" {
      entry.2 = value_num;
      continue;
    }
    entry.0.insert(column_key, read_cell_value(value_num, value_text));
    if entry.1.is_none() {
      entry.1 = row_name;
    }
  }

  let mut items: Vec<(i64, Map<String, Value>, Option<String>, Option<f64>)> = by_row
    .into_iter()
    .map(|(row_no, (row, name, sort))| (row_no, row, name, sort))
    .collect();

  items.sort_by(|a, b| {
    let ai = a.3.unwrap_or(a.0 as f64);
    let bi = b.3.unwrap_or(b.0 as f64);
    if a.0 >= 900_000_000 && b.0 >= 900_000_000 {
      ai.partial_cmp(&bi).unwrap_or(std::cmp::Ordering::Equal)
    } else {
      a.0.cmp(&b.0)
    }
  });

  items
    .into_iter()
    .map(|(row_no, mut row, row_name, _)| {
      if let Some(name) = row_name {
        if !row.contains_key("name") {
          row.insert("name".into(), Value::String(name));
        }
      }
      if !row.contains_key("num") && row_no < 900_000_000 {
        row.insert("num".into(), Value::String(row_no.to_string()));
      }
      row
    })
    .collect()
}

#[tauri::command]
fn runtime_info() -> serde_json::Value {
  serde_json::json!({
    "runtime": "tauri2",
    "version": env!("CARGO_PKG_VERSION"),
  })
}

#[tauri::command]
fn open_package(
  folder_path: String,
  state: State<'_, AppState>,
) -> Result<OpenPackageResult, AppError> {
  let folder = PathBuf::from(&folder_path);
  if !folder.is_dir() {
    return Err(AppError::Message("Указанный путь не является папкой".into()));
  }
  let meta = read_meta(&folder)?;
  let db_path = folder.join("oko.db");
  let conn = open_db(&db_path)?;
  let instances = count_instances(&conn)?;

  let result = OpenPackageResult {
    folder_path: folder.display().to_string(),
    meta: meta.clone(),
    db_path: db_path.display().to_string(),
    instances,
  };

  let mut guard = state
    .package
    .lock()
    .map_err(|_| AppError::Message("state lock poisoned".into()))?;
  *guard = Some(PackageState {
    folder,
    db_path,
    meta,
    conn,
  });
  Ok(result)
}

#[tauri::command]
fn close_package(state: State<'_, AppState>) -> Result<bool, AppError> {
  let mut guard = state
    .package
    .lock()
    .map_err(|_| AppError::Message("state lock poisoned".into()))?;
  *guard = None;
  Ok(true)
}

#[tauri::command]
fn list_instance_ids(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
  with_package(&state, |pkg| {
    let mut stmt = pkg
      .conn
      .prepare(
        "SELECT instance_id FROM form_instances
         ORDER BY template_id, updated_at DESC",
      )
      .map_err(|e| AppError::Message(format!("prepare failed: {e}")))?;
    let rows = stmt
      .query_map([], |row| row.get::<_, String>(0))
      .map_err(|e| AppError::Message(format!("query failed: {e}")))?;
    let mut out = Vec::new();
    for r in rows {
      out.push(r.map_err(|e| AppError::Message(format!("row failed: {e}")))?);
    }
    Ok(out)
  })
}

#[tauri::command]
fn list_summaries(state: State<'_, AppState>) -> Result<Vec<InstanceSummary>, AppError> {
  with_package(&state, |pkg| {
    let mut stmt = pkg
      .conn
      .prepare(
        r#"SELECT instance_id, template_id, template_title, display_name, organization,
                period_start, period_end, zid, eid, status, created_at, updated_at
         FROM form_instances
         WHERE zid = ?1 AND eid = ?2
         ORDER BY template_id"#,
      )
      .map_err(|e| AppError::Message(format!("prepare failed: {e}")))?;

    // Prefer package zid/eid; fall back to all rows if none match
    let zid = pkg.meta.zid;
    let eid = pkg.meta.eid;
    let mut rows = stmt
      .query_map(params![zid, eid], |row| {
        Ok(InstanceSummary {
          instance_id: row.get(0)?,
          template_id: row.get(1)?,
          template_title: row
            .get::<_, Option<String>>(2)?
            .unwrap_or_else(|| row.get::<_, String>(1).unwrap_or_default()),
          display_name: row.get(3)?,
          organization: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
          period_start: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
          period_end: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
          zid: row.get(7)?,
          eid: row.get(8)?,
          status: {
            let s: Option<String> = row.get(9)?;
            if s.as_deref() == Some("submitted") {
              "submitted".into()
            } else {
              "draft".into()
            }
          },
          created_at: row.get(10)?,
          updated_at: row.get(11)?,
        })
      })
      .map_err(|e| AppError::Message(format!("query failed: {e}")))?;

    let mut out = Vec::new();
    for r in rows.by_ref() {
      out.push(r.map_err(|e| AppError::Message(format!("row failed: {e}")))?);
    }
    if out.is_empty() {
      // fallback: all instances
      let mut stmt2 = pkg
        .conn
        .prepare(
          r#"SELECT instance_id, template_id, template_title, display_name, organization,
                  period_start, period_end, zid, eid, status, created_at, updated_at
           FROM form_instances ORDER BY template_id"#,
        )
        .map_err(|e| AppError::Message(format!("prepare failed: {e}")))?;
      let rows2 = stmt2
        .query_map([], |row| {
          Ok(InstanceSummary {
            instance_id: row.get(0)?,
            template_id: row.get(1)?,
            template_title: row
              .get::<_, Option<String>>(2)?
              .unwrap_or_else(|| row.get::<_, String>(1).unwrap_or_default()),
            display_name: row.get(3)?,
            organization: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            period_start: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            period_end: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            zid: row.get(7)?,
            eid: row.get(8)?,
            status: {
              let s: Option<String> = row.get(9)?;
              if s.as_deref() == Some("submitted") {
                "submitted".into()
              } else {
                "draft".into()
              }
            },
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
          })
        })
        .map_err(|e| AppError::Message(format!("query failed: {e}")))?;
      for r in rows2 {
        out.push(r.map_err(|e| AppError::Message(format!("row failed: {e}")))?);
      }
    }
    Ok(out)
  })
}

#[tauri::command]
fn load_instance(
  instance_id: String,
  state: State<'_, AppState>,
) -> Result<OkoFormInstance, AppError> {
  with_package(&state, |pkg| {
    let header = pkg
      .conn
      .query_row(
        r#"SELECT instance_id, template_id, zid, eid, template_title, display_name, organization,
                period_start, period_end, unit, enterprise_code, signatures_json,
                COALESCE(rash_entries_json, '[]'), status, created_at, updated_at
         FROM form_instances WHERE instance_id = ?1"#,
        params![instance_id],
        |row| {
          Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<i64>>(2)?,
            row.get::<_, Option<i64>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
            row.get::<_, Option<String>>(10)?,
            row.get::<_, String>(11)?,
            row.get::<_, String>(12)?,
            row.get::<_, Option<String>>(13)?,
            row.get::<_, String>(14)?,
            row.get::<_, String>(15)?,
          ))
        },
      )
      .optional()
      .map_err(|e| AppError::Message(format!("load header failed: {e}")))?
      .ok_or_else(|| AppError::Message("Instance not found".into()))?;

    let (
      instance_id,
      template_id,
      zid,
      eid,
      template_title,
      display_name,
      organization,
      period_start,
      period_end,
      unit,
      enterprise_code,
      signatures_json,
      rash_entries_json,
      status,
      created_at,
      updated_at,
    ) = header;

    let mut stmt = pkg
      .conn
      .prepare(
        r#"SELECT row_no, row_name, column_key, value_num, value_text
         FROM form_cell_values WHERE instance_id = ?1
         ORDER BY row_no, column_key"#,
      )
      .map_err(|e| AppError::Message(format!("prepare cells failed: {e}")))?;
    let cell_iter = stmt
      .query_map(params![instance_id], |row| {
        Ok((
          row.get::<_, i64>(0)?,
          row.get::<_, Option<String>>(1)?,
          row.get::<_, String>(2)?,
          row.get::<_, Option<f64>>(3)?,
          row.get::<_, Option<String>>(4)?,
        ))
      })
      .map_err(|e| AppError::Message(format!("query cells failed: {e}")))?;

    let mut cells = Vec::new();
    for c in cell_iter {
      cells.push(c.map_err(|e| AppError::Message(format!("cell row failed: {e}")))?);
    }

    let signatures: Map<String, Value> =
      serde_json::from_str(&signatures_json).unwrap_or_default();
    let rash_entries: Value =
      serde_json::from_str(&rash_entries_json).unwrap_or(Value::Array(vec![]));

    Ok(OkoFormInstance {
      instance_id,
      template_id: template_id.clone(),
      template_title: template_title.unwrap_or(template_id),
      display_name,
      zid,
      eid,
      status: Some(if status.as_deref() == Some("submitted") {
        "submitted".into()
      } else {
        "draft".into()
      }),
      meta: FormMeta {
        organization: organization.unwrap_or_default(),
        enterprise_code: enterprise_code.unwrap_or_else(|| "1@1".into()),
        period_start: period_start.unwrap_or_default(),
        period_end: period_end.unwrap_or_default(),
        unit: unit.unwrap_or_else(|| "тыс.руб.".into()),
      },
      rows: rows_from_cells(cells),
      signatures,
      rash_entries: Some(rash_entries),
      created_at,
      updated_at,
    })
  })
}

#[tauri::command]
fn save_instance(
  inst: OkoFormInstance,
  state: State<'_, AppState>,
) -> Result<OkoFormInstance, AppError> {
  with_package(&state, |pkg| {
    let now = chrono_lite_now();
    let status = if inst.status.as_deref() == Some("submitted") {
      "submitted"
    } else {
      "draft"
    };
    let signatures_json =
      serde_json::to_string(&inst.signatures).unwrap_or_else(|_| "{}".into());
    let rash_json = inst
      .rash_entries
      .as_ref()
      .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".into()))
      .unwrap_or_else(|| "[]".into());
    let updated_at = if inst.updated_at.is_empty() {
      now.clone()
    } else {
      now.clone()
    };

    pkg
      .conn
      .execute(
        r#"INSERT INTO form_instances (
          instance_id, template_id, zid, eid, template_title, display_name, organization,
          period_start, period_end, unit, enterprise_code, signatures_json, rash_entries_json, status,
          created_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
        ON CONFLICT(instance_id) DO UPDATE SET
          template_id=excluded.template_id,
          zid=excluded.zid,
          eid=excluded.eid,
          template_title=excluded.template_title,
          display_name=excluded.display_name,
          organization=excluded.organization,
          period_start=excluded.period_start,
          period_end=excluded.period_end,
          unit=excluded.unit,
          enterprise_code=excluded.enterprise_code,
          signatures_json=excluded.signatures_json,
          rash_entries_json=excluded.rash_entries_json,
          status=excluded.status,
          updated_at=excluded.updated_at"#,
        params![
          inst.instance_id,
          inst.template_id,
          inst.zid,
          inst.eid,
          inst.template_title,
          inst.display_name,
          inst.meta.organization,
          null_if_empty(&inst.meta.period_start),
          null_if_empty(&inst.meta.period_end),
          inst.meta.unit,
          inst.meta.enterprise_code,
          signatures_json,
          rash_json,
          status,
          inst.created_at,
          updated_at,
        ],
      )
      .map_err(|e| AppError::Message(format!("upsert instance failed: {e}")))?;

    pkg
      .conn
      .execute(
        "DELETE FROM form_cell_values WHERE instance_id = ?1",
        params![inst.instance_id],
      )
      .map_err(|e| AppError::Message(format!("delete cells failed: {e}")))?;

    let mut insert = pkg
      .conn
      .prepare(
        r#"INSERT INTO form_cell_values (
          instance_id, row_no, row_name, column_key, value_num, value_text, updated_at, updated_by, updated_client_id
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"#,
      )
      .map_err(|e| AppError::Message(format!("prepare insert failed: {e}")))?;

    for (index, row) in inst.rows.iter().enumerate() {
      let row_no = resolve_row_no(row, index);
      let row_name = row
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
      for (key, val) in row {
        let (value_num, value_text) = cell_value_parts(val);
        if value_num.is_none() && value_text.is_none() {
          continue;
        }
        insert
          .execute(params![
            inst.instance_id,
            row_no,
            if row_name.is_empty() {
              None::<String>
            } else {
              Some(row_name.clone())
            },
            key,
            value_num,
            value_text,
            updated_at,
            None::<String>,
            None::<String>,
          ])
          .map_err(|e| AppError::Message(format!("insert cell failed: {e}")))?;
      }
      if !row.contains_key("num") && row_no >= 900_000_000 {
        insert
          .execute(params![
            inst.instance_id,
            row_no,
            if row_name.is_empty() {
              None::<String>
            } else {
              Some(row_name.clone())
            },
            "_row_index",
            Some(index as f64),
            None::<String>,
            updated_at,
            None::<String>,
            None::<String>,
          ])
          .map_err(|e| AppError::Message(format!("insert row index failed: {e}")))?;
      }
    }

    let mut saved = inst;
    saved.status = Some(status.into());
    saved.updated_at = updated_at;
    Ok(saved)
  })
}

fn null_if_empty(s: &str) -> Option<&str> {
  if s.is_empty() {
    None
  } else {
    Some(s)
  }
}

fn chrono_lite_now() -> String {
  // RFC3339-ish UTC without chrono crate dependency
  use std::time::{SystemTime, UNIX_EPOCH};
  let secs = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);
  format!("{secs}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(AppState {
      package: Mutex::new(None),
    })
    .invoke_handler(tauri::generate_handler![
      runtime_info,
      open_package,
      close_package,
      list_instance_ids,
      list_summaries,
      load_instance,
      save_instance
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
