use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

const SCHEMA_VERSION: u32 = 1;

fn write_schema_version(folder: &Path) -> Result<(), AppError> {
  let oko = folder.join(".oko");
  fs::create_dir_all(&oko).map_err(|e| AppError::Message(format!("mkdir .oko failed: {e}")))?;
  fs::write(oko.join("schema_version"), format!("{SCHEMA_VERSION}\n"))
    .map_err(|e| AppError::Message(format!("write schema_version failed: {e}")))?;
  Ok(())
}

fn logs_dir() -> PathBuf {
  if let Ok(appdata) = std::env::var("APPDATA") {
    return PathBuf::from(appdata).join("OKO-Filler").join("logs");
  }
  if let Ok(home) = std::env::var("HOME") {
    let mac = PathBuf::from(&home).join("Library").join("Logs").join("OKO-Filler");
    if cfg!(target_os = "macos") {
      return mac;
    }
    return PathBuf::from(home)
      .join(".local")
      .join("share")
      .join("OKO-Filler")
      .join("logs");
  }
  PathBuf::from("OKO-Filler-logs")
}
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
  #[serde(default)]
  pub settings: Option<MetaSettings>,
  #[serde(default)]
  pub coordinator_pin_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPackageResult {
  pub folder_path: String,
  pub meta: PackageMeta,
  pub db_path: String,
  pub instances: usize,
  pub has_coordinator_pin: bool,
  pub restrict_executors_to_assignments: bool,
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
  client_id: String,
  machine_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationSettings {
  pub heartbeat_interval_sec: u32,
  pub presence_stale_sec: u32,
  pub sync_poll_interval_sec: u32,
}

impl Default for CollaborationSettings {
  fn default() -> Self {
    Self {
      heartbeat_interval_sec: 5,
      presence_stale_sec: 30,
      sync_poll_interval_sec: 3,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetaSettings {
  pub heartbeat_interval_sec: Option<u32>,
  pub presence_stale_sec: Option<u32>,
  pub sync_poll_interval_sec: Option<u32>,
  pub restrict_executors_to_assignments: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellPresence {
  pub instance_id: String,
  pub row_no: i64,
  pub column_key: String,
  pub user_name: String,
  pub machine_name: Option<String>,
  pub client_id: String,
  pub heartbeat_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimCellResult {
  pub ok: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub occupied_by: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellChange {
  pub row_no: i64,
  pub column_key: String,
  pub value: Value,
  pub updated_at: String,
  pub updated_by: Option<String>,
  pub updated_client_id: Option<String>,
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

  conn
    .execute_batch(
      r#"
      CREATE TABLE IF NOT EXISTS cell_presence (
        instance_id TEXT NOT NULL,
        row_no INTEGER NOT NULL,
        column_key TEXT NOT NULL,
        user_name TEXT NOT NULL,
        machine_name TEXT,
        client_id TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        PRIMARY KEY (instance_id, row_no, column_key)
      );
      CREATE INDEX IF NOT EXISTS idx_cell_presence_heartbeat
        ON cell_presence(heartbeat_at);
      CREATE INDEX IF NOT EXISTS idx_cell_presence_client
        ON cell_presence(client_id);
      CREATE TABLE IF NOT EXISTS local_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        instance_id TEXT,
        row_no INTEGER,
        column_key TEXT,
        actor TEXT,
        details TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      "#,
    )
    .map_err(|e| AppError::Message(format!("migrate presence failed: {e}")))?;

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
  let _ = write_schema_version(&folder);
  let result = OpenPackageResult {
    folder_path: folder.display().to_string(),
    meta: meta.clone(),
    db_path: db_path.display().to_string(),
    instances,
    has_coordinator_pin: meta.coordinator_pin_hash.as_ref().is_some_and(|s| !s.is_empty()),
    restrict_executors_to_assignments: meta
      .settings
      .as_ref()
      .and_then(|s| s.restrict_executors_to_assignments)
      .unwrap_or(false),
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

fn iso_now() -> String {
  time::OffsetDateTime::now_utc()
    .format(&time::format_description::well_known::Rfc3339)
    .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

fn chrono_lite_now() -> String {
  iso_now()
}

fn stale_cutoff(stale_sec: u32) -> String {
  let now = time::OffsetDateTime::now_utc();
  let cut = now - time::Duration::seconds(stale_sec as i64);
  cut
    .format(&time::format_description::well_known::Rfc3339)
    .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

fn collaboration_settings_from_meta(meta: &PackageMeta) -> CollaborationSettings {
  let defaults = CollaborationSettings::default();
  match &meta.settings {
    Some(s) => CollaborationSettings {
      heartbeat_interval_sec: s.heartbeat_interval_sec.unwrap_or(defaults.heartbeat_interval_sec),
      presence_stale_sec: s.presence_stale_sec.unwrap_or(defaults.presence_stale_sec),
      sync_poll_interval_sec: s
        .sync_poll_interval_sec
        .unwrap_or(defaults.sync_poll_interval_sec),
    },
    None => defaults,
  }
}

fn prune_stale_presence(conn: &Connection, stale_sec: u32) -> Result<(), AppError> {
  let cutoff = stale_cutoff(stale_sec);
  conn
    .execute(
      "DELETE FROM cell_presence WHERE heartbeat_at < ?1",
      params![cutoff],
    )
    .map_err(|e| AppError::Message(format!("prune presence failed: {e}")))?;
  Ok(())
}

fn machine_name() -> String {
  std::env::var("COMPUTERNAME")
    .or_else(|_| std::env::var("HOSTNAME"))
    .or_else(|_| {
      std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| {
          let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
          if s.is_empty() {
            None
          } else {
            Some(s)
          }
        })
        .ok_or(std::env::VarError::NotPresent)
    })
    .unwrap_or_else(|_| "pc".into())
}

#[tauri::command]
fn get_client_id(state: State<'_, AppState>) -> String {
  state.client_id.clone()
}

#[tauri::command]
fn get_collaboration_settings(state: State<'_, AppState>) -> Result<CollaborationSettings, AppError> {
  with_package(&state, |pkg| Ok(collaboration_settings_from_meta(&pkg.meta)))
}

#[tauri::command]
fn claim_cell(
  instance_id: String,
  row_no: i64,
  column_key: String,
  user_name: String,
  state: State<'_, AppState>,
) -> Result<ClaimCellResult, AppError> {
  let client_id = state.client_id.clone();
  let machine = state.machine_name.clone();
  with_package(&state, |pkg| {
    let cfg = collaboration_settings_from_meta(&pkg.meta);
    prune_stale_presence(&pkg.conn, cfg.presence_stale_sec)?;
    let now = iso_now();
    let cutoff = stale_cutoff(cfg.presence_stale_sec);

    let tx = pkg
      .conn
      .unchecked_transaction()
      .map_err(|e| AppError::Message(format!("tx failed: {e}")))?;

    tx.execute(
      "DELETE FROM cell_presence WHERE client_id = ?1",
      params![client_id],
    )
    .map_err(|e| AppError::Message(format!("release self failed: {e}")))?;

    let occupied: Option<String> = if column_key == "*" {
      tx.query_row(
        r#"SELECT user_name FROM cell_presence
         WHERE instance_id = ?1 AND row_no = ?2
           AND client_id != ?3 AND heartbeat_at >= ?4
         LIMIT 1"#,
        params![instance_id, row_no, client_id, cutoff],
        |row| row.get(0),
      )
      .optional()
      .map_err(|e| AppError::Message(format!("occupy check failed: {e}")))?
    } else {
      tx.query_row(
        r#"SELECT user_name FROM cell_presence
         WHERE instance_id = ?1 AND row_no = ?2
           AND client_id != ?3 AND heartbeat_at >= ?4
           AND (column_key = ?5 OR column_key = '*')
         LIMIT 1"#,
        params![instance_id, row_no, client_id, cutoff, column_key],
        |row| row.get(0),
      )
      .optional()
      .map_err(|e| AppError::Message(format!("occupy check failed: {e}")))?
    };

    if let Some(name) = occupied {
      tx.commit()
        .map_err(|e| AppError::Message(format!("tx commit failed: {e}")))?;
      return Ok(ClaimCellResult {
        ok: false,
        occupied_by: Some(name),
      });
    }

    tx.execute(
      r#"INSERT OR REPLACE INTO cell_presence (
        instance_id, row_no, column_key, user_name, machine_name, client_id, heartbeat_at
      ) VALUES (?1,?2,?3,?4,?5,?6,?7)"#,
      params![
        instance_id,
        row_no,
        column_key,
        user_name,
        machine,
        client_id,
        now
      ],
    )
    .map_err(|e| AppError::Message(format!("claim failed: {e}")))?;

    tx.commit()
      .map_err(|e| AppError::Message(format!("tx commit failed: {e}")))?;
    Ok(ClaimCellResult {
      ok: true,
      occupied_by: None,
    })
  })
}

#[tauri::command]
fn release_presence(state: State<'_, AppState>) -> Result<bool, AppError> {
  let client_id = state.client_id.clone();
  let mut guard = state
    .package
    .lock()
    .map_err(|_| AppError::Message("state lock poisoned".into()))?;
  if let Some(pkg) = guard.as_mut() {
    pkg
      .conn
      .execute(
        "DELETE FROM cell_presence WHERE client_id = ?1",
        params![client_id],
      )
      .map_err(|e| AppError::Message(format!("release failed: {e}")))?;
  }
  Ok(true)
}

#[tauri::command]
fn heartbeat_cell(
  instance_id: String,
  row_no: i64,
  column_key: String,
  state: State<'_, AppState>,
) -> Result<bool, AppError> {
  let client_id = state.client_id.clone();
  with_package(&state, |pkg| {
    let now = iso_now();
    let n = pkg
      .conn
      .execute(
        r#"UPDATE cell_presence SET heartbeat_at = ?1
         WHERE client_id = ?2 AND instance_id = ?3 AND row_no = ?4 AND column_key = ?5"#,
        params![now, client_id, instance_id, row_no, column_key],
      )
      .map_err(|e| AppError::Message(format!("heartbeat failed: {e}")))?;
    Ok(n > 0)
  })
}

#[tauri::command]
fn list_instance_presence(
  instance_id: String,
  state: State<'_, AppState>,
) -> Result<Vec<CellPresence>, AppError> {
  let client_id = state.client_id.clone();
  with_package(&state, |pkg| {
    let cfg = collaboration_settings_from_meta(&pkg.meta);
    prune_stale_presence(&pkg.conn, cfg.presence_stale_sec)?;
    let cutoff = stale_cutoff(cfg.presence_stale_sec);
    let mut stmt = pkg
      .conn
      .prepare(
        r#"SELECT instance_id, row_no, column_key, user_name, machine_name, client_id, heartbeat_at
         FROM cell_presence
         WHERE instance_id = ?1 AND client_id != ?2 AND heartbeat_at >= ?3"#,
      )
      .map_err(|e| AppError::Message(format!("prepare presence failed: {e}")))?;
    let rows = stmt
      .query_map(params![instance_id, client_id, cutoff], |row| {
        Ok(CellPresence {
          instance_id: row.get(0)?,
          row_no: row.get(1)?,
          column_key: row.get(2)?,
          user_name: row.get(3)?,
          machine_name: row.get(4)?,
          client_id: row.get(5)?,
          heartbeat_at: row.get(6)?,
        })
      })
      .map_err(|e| AppError::Message(format!("query presence failed: {e}")))?;
    let mut out = Vec::new();
    for r in rows {
      out.push(r.map_err(|e| AppError::Message(format!("presence row failed: {e}")))?);
    }
    Ok(out)
  })
}

#[tauri::command]
fn list_cell_changes(
  instance_id: String,
  since_iso: String,
  state: State<'_, AppState>,
) -> Result<Vec<CellChange>, AppError> {
  with_package(&state, |pkg| {
    let mut stmt = pkg
      .conn
      .prepare(
        r#"SELECT row_no, column_key, value_num, value_text, updated_at, updated_by, updated_client_id
         FROM form_cell_values
         WHERE instance_id = ?1 AND updated_at > ?2 AND column_key != '_row_index'
         ORDER BY updated_at"#,
      )
      .map_err(|e| AppError::Message(format!("prepare changes failed: {e}")))?;
    let rows = stmt
      .query_map(params![instance_id, since_iso], |row| {
        let row_no: i64 = row.get(0)?;
        let column_key: String = row.get(1)?;
        let value_num: Option<f64> = row.get(2)?;
        let value_text: Option<String> = row.get(3)?;
        let updated_at: Option<String> = row.get(4)?;
        let updated_by: Option<String> = row.get(5)?;
        let updated_client_id: Option<String> = row.get(6)?;
        Ok((
          row_no,
          column_key,
          value_num,
          value_text,
          updated_at,
          updated_by,
          updated_client_id,
        ))
      })
      .map_err(|e| AppError::Message(format!("query changes failed: {e}")))?;

    let mut out = Vec::new();
    for r in rows {
      let (row_no, column_key, value_num, value_text, updated_at, updated_by, updated_client_id) =
        r.map_err(|e| AppError::Message(format!("change row failed: {e}")))?;
      let Some(updated_at) = updated_at else {
        continue;
      };
      out.push(CellChange {
        row_no,
        column_key,
        value: read_cell_value(value_num, value_text),
        updated_at,
        updated_by,
        updated_client_id,
      });
    }
    Ok(out)
  })
}

#[tauri::command]
fn save_cell(
  instance_id: String,
  row_no: i64,
  row_name: Option<String>,
  column_key: String,
  value: Value,
  user_name: String,
  state: State<'_, AppState>,
) -> Result<serde_json::Value, AppError> {
  let client_id = state.client_id.clone();
  with_package(&state, |pkg| {
    let now = iso_now();
    let (value_num, value_text) = cell_value_parts(&value);
    let tx = pkg
      .conn
      .unchecked_transaction()
      .map_err(|e| AppError::Message(format!("tx failed: {e}")))?;

    if value_num.is_none() && value_text.is_none() {
      tx.execute(
        r#"DELETE FROM form_cell_values
         WHERE instance_id = ?1 AND row_no = ?2 AND column_key = ?3"#,
        params![instance_id, row_no, column_key],
      )
      .map_err(|e| AppError::Message(format!("delete cell failed: {e}")))?;
    } else {
      tx.execute(
        r#"INSERT INTO form_cell_values (
          instance_id, row_no, row_name, column_key, value_num, value_text,
          updated_at, updated_by, updated_client_id
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
        ON CONFLICT(instance_id, row_no, column_key) DO UPDATE SET
          row_name = excluded.row_name,
          value_num = excluded.value_num,
          value_text = excluded.value_text,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by,
          updated_client_id = excluded.updated_client_id"#,
        params![
          instance_id,
          row_no,
          row_name,
          column_key,
          value_num,
          value_text,
          now,
          user_name,
          client_id
        ],
      )
      .map_err(|e| AppError::Message(format!("upsert cell failed: {e}")))?;
    }

    tx.execute(
      "UPDATE form_instances SET updated_at = ?1 WHERE instance_id = ?2",
      params![now, instance_id],
    )
    .map_err(|e| AppError::Message(format!("touch instance failed: {e}")))?;

    tx.commit()
      .map_err(|e| AppError::Message(format!("tx commit failed: {e}")))?;

    Ok(serde_json::json!({ "updatedAt": now }))
  })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentItem {
  pub template_id: String,
  pub assignee: String,
  pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentsFile {
  pub updated_at: String,
  pub items: Vec<AssignmentItem>,
}

fn assignments_path(folder: &Path) -> PathBuf {
  folder.join("assignments.json")
}

fn read_assignments(folder: &Path) -> AssignmentsFile {
  let p = assignments_path(folder);
  if !p.exists() {
    return AssignmentsFile {
      updated_at: "1970-01-01T00:00:00.000Z".into(),
      items: vec![],
    };
  }
  match fs::read_to_string(&p) {
    Ok(raw) => serde_json::from_str(&raw).unwrap_or(AssignmentsFile {
      updated_at: "1970-01-01T00:00:00.000Z".into(),
      items: vec![],
    }),
    Err(_) => AssignmentsFile {
      updated_at: "1970-01-01T00:00:00.000Z".into(),
      items: vec![],
    },
  }
}

fn write_package_meta(folder: &Path, meta: &PackageMeta) -> Result<(), AppError> {
  let meta_path = folder.join("package.meta.json");
  let raw = serde_json::to_string_pretty(meta)
    .map_err(|e| AppError::Message(format!("serialize meta failed: {e}")))?;
  fs::write(&meta_path, raw + "\n")
    .map_err(|e| AppError::Message(format!("write package.meta.json failed: {e}")))?;
  Ok(())
}

fn hash_pin(pin: &str, salt: &str) -> String {
  use sha2::{Digest, Sha256};
  let mut hasher = Sha256::new();
  hasher.update(format!("{salt}:{pin}").as_bytes());
  hex::encode(hasher.finalize())
}

fn encode_pin_hash(pin: &str) -> Result<String, AppError> {
  let mut salt_bytes = [0u8; 16];
  getrandom::fill(&mut salt_bytes)
    .map_err(|e| AppError::Message(format!("random salt failed: {e}")))?;
  let salt = hex::encode(salt_bytes);
  Ok(format!("{}:{}", salt, hash_pin(pin, &salt)))
}

fn verify_pin_hash(pin: &str, stored: Option<&str>) -> bool {
  let Some(stored) = stored else {
    return false;
  };
  let mut parts = stored.splitn(2, ':');
  let Some(salt) = parts.next() else {
    return false;
  };
  let Some(expected) = parts.next() else {
    return false;
  };
  let actual = hash_pin(pin, salt);
  if actual.len() != expected.len() {
    return false;
  }
  // constant-time-ish compare
  actual
    .as_bytes()
    .iter()
    .zip(expected.as_bytes().iter())
    .fold(0u8, |acc, (a, b)| acc | (a ^ b))
    == 0
}

#[tauri::command]
fn get_assignments(state: State<'_, AppState>) -> Result<AssignmentsFile, AppError> {
  with_package(&state, |pkg| Ok(read_assignments(&pkg.folder)))
}

#[tauri::command]
fn save_assignments(
  items: Vec<AssignmentItem>,
  state: State<'_, AppState>,
) -> Result<AssignmentsFile, AppError> {
  with_package(&state, |pkg| {
    let data = AssignmentsFile {
      updated_at: iso_now(),
      items,
    };
    let raw = serde_json::to_string_pretty(&data)
      .map_err(|e| AppError::Message(format!("serialize assignments failed: {e}")))?;
    fs::write(assignments_path(&pkg.folder), raw + "\n")
      .map_err(|e| AppError::Message(format!("write assignments.json failed: {e}")))?;
    Ok(data)
  })
}

#[tauri::command]
fn list_known_assignees(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
  with_package(&state, |pkg| {
    let mut names: Vec<String> = read_assignments(&pkg.folder)
      .items
      .into_iter()
      .filter_map(|i| {
        let t = i.assignee.trim().to_string();
        if t.is_empty() {
          None
        } else {
          Some(t)
        }
      })
      .collect();
    names.sort();
    names.dedup();
    Ok(names)
  })
}

#[tauri::command]
fn has_coordinator_pin(state: State<'_, AppState>) -> Result<bool, AppError> {
  with_package(&state, |pkg| {
    Ok(
      pkg
        .meta
        .coordinator_pin_hash
        .as_ref()
        .is_some_and(|s| !s.is_empty()),
    )
  })
}

#[tauri::command]
fn verify_coordinator_pin(pin: String, state: State<'_, AppState>) -> Result<bool, AppError> {
  with_package(&state, |pkg| {
    Ok(verify_pin_hash(
      &pin,
      pkg.meta.coordinator_pin_hash.as_deref(),
    ))
  })
}

#[tauri::command]
fn set_coordinator_pin(
  pin: String,
  old_pin: Option<String>,
  state: State<'_, AppState>,
) -> Result<bool, AppError> {
  with_package(&state, |pkg| {
    if pkg
      .meta
      .coordinator_pin_hash
      .as_ref()
      .is_some_and(|s| !s.is_empty())
    {
      let ok = old_pin
        .as_deref()
        .is_some_and(|p| verify_pin_hash(p, pkg.meta.coordinator_pin_hash.as_deref()));
      if !ok {
        return Err(AppError::Message(
          "Неверный текущий PIN координатора".into(),
        ));
      }
    }
    if pin.chars().count() < 4 {
      return Err(AppError::Message(
        "PIN должен быть не короче 4 символов".into(),
      ));
    }
    pkg.meta.coordinator_pin_hash = Some(encode_pin_hash(&pin)?);
    write_package_meta(&pkg.folder, &pkg.meta)?;
    Ok(true)
  })
}

#[tauri::command]
fn set_restrict_executors(
  restrict: bool,
  state: State<'_, AppState>,
) -> Result<bool, AppError> {
  with_package(&state, |pkg| {
    let mut settings = pkg.meta.settings.clone().unwrap_or_default();
    settings.restrict_executors_to_assignments = Some(restrict);
    pkg.meta.settings = Some(settings);
    write_package_meta(&pkg.folder, &pkg.meta)?;
    Ok(restrict)
  })
}

#[tauri::command]
fn set_instance_status(
  instance_id: String,
  status: String,
  state: State<'_, AppState>,
) -> Result<OkoFormInstance, AppError> {
  let status = if matches!(status.as_str(), "submitted" | "ready" | "accepted") {
    "submitted"
  } else {
    "draft"
  };
  // load then touch status in DB (without rewriting all cells)
  with_package(&state, |pkg| {
    let now = iso_now();
    let n = pkg
      .conn
      .execute(
        "UPDATE form_instances SET status = ?1, updated_at = ?2 WHERE instance_id = ?3",
        params![status, now, instance_id],
      )
      .map_err(|e| AppError::Message(format!("set status failed: {e}")))?;
    if n == 0 {
      return Err(AppError::Message("Форма не найдена".into()));
    }
    Ok(())
  })?;
  load_instance(instance_id, state)
}

fn assert_coordinator_pin(pkg: &PackageState, pin: Option<&str>) -> Result<(), AppError> {
  let has = pkg
    .meta
    .coordinator_pin_hash
    .as_ref()
    .is_some_and(|s| !s.is_empty());
  if !has {
    return Ok(());
  }
  let Some(pin) = pin else {
    return Err(AppError::Message("Требуется PIN координатора".into()));
  };
  if !verify_pin_hash(pin, pkg.meta.coordinator_pin_hash.as_deref()) {
    return Err(AppError::Message("Неверный PIN координатора".into()));
  }
  Ok(())
}

fn insert_audit(
  conn: &Connection,
  action: &str,
  instance_id: Option<&str>,
  row_no: Option<i64>,
  column_key: Option<&str>,
  actor: &str,
  details: Option<&str>,
) -> Result<(), AppError> {
  conn
    .execute(
      r#"INSERT INTO local_audit (action, instance_id, row_no, column_key, actor, details, created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7)"#,
      params![
        action,
        instance_id,
        row_no,
        column_key,
        actor,
        details,
        iso_now()
      ],
    )
    .map_err(|e| AppError::Message(format!("audit insert failed: {e}")))?;
  Ok(())
}

#[tauri::command]
fn backup_database(
  actor: String,
  pin: Option<String>,
  state: State<'_, AppState>,
) -> Result<String, AppError> {
  with_package(&state, |pkg| {
    assert_coordinator_pin(pkg, pin.as_deref())?;
    let backups = pkg.folder.join("backups");
    fs::create_dir_all(&backups)
      .map_err(|e| AppError::Message(format!("mkdir backups failed: {e}")))?;
    let stamp = iso_now().replace(':', "-").replace('.', "-");
    let stamp = stamp.chars().take(19).collect::<String>();
    let dest = backups.join(format!("oko_{stamp}.db"));

    let _ = pkg.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    fs::copy(&pkg.db_path, &dest)
      .map_err(|e| AppError::Message(format!("copy db failed: {e}")))?;

    let dest_s = dest.display().to_string();
    insert_audit(
      &pkg.conn,
      "backup_db",
      None,
      None,
      None,
      &actor,
      Some(&dest_s),
    )?;
    Ok(dest_s)
  })
}

#[tauri::command]
fn force_unlock(
  instance_id: String,
  actor: String,
  pin: Option<String>,
  row_no: Option<i64>,
  column_key: Option<String>,
  state: State<'_, AppState>,
) -> Result<i64, AppError> {
  with_package(&state, |pkg| {
    assert_coordinator_pin(pkg, pin.as_deref())?;
    let n = match (row_no, column_key.as_ref()) {
      (Some(rn), Some(ck)) => pkg
        .conn
        .execute(
          "DELETE FROM cell_presence WHERE instance_id = ?1 AND row_no = ?2 AND column_key = ?3",
          params![instance_id, rn, ck],
        )
        .map_err(|e| AppError::Message(format!("force unlock failed: {e}")))?,
      _ => pkg
        .conn
        .execute(
          "DELETE FROM cell_presence WHERE instance_id = ?1",
          params![instance_id],
        )
        .map_err(|e| AppError::Message(format!("force unlock failed: {e}")))?,
    };
    if n > 0 {
      insert_audit(
        &pkg.conn,
        "presence_force_unlock",
        Some(&instance_id),
        row_no,
        column_key.as_deref(),
        &actor,
        None,
      )?;
    }
    Ok(n as i64)
  })
}

#[tauri::command]
fn export_package_json(
  actor: String,
  pin: Option<String>,
  state: State<'_, AppState>,
) -> Result<String, AppError> {
  // Collect instance IDs under lock, then load each (re-enter with_package)
  let (folder, meta, ids) = with_package(&state, |pkg| {
    assert_coordinator_pin(pkg, pin.as_deref())?;
    let mut stmt = pkg
      .conn
      .prepare("SELECT instance_id FROM form_instances ORDER BY template_id")
      .map_err(|e| AppError::Message(format!("prepare failed: {e}")))?;
    let rows = stmt
      .query_map([], |row| row.get::<_, String>(0))
      .map_err(|e| AppError::Message(format!("query failed: {e}")))?;
    let mut ids = Vec::new();
    for r in rows {
      ids.push(r.map_err(|e| AppError::Message(format!("row failed: {e}")))?);
    }
    Ok((pkg.folder.clone(), pkg.meta.clone(), ids))
  })?;

  let mut instances = Vec::new();
  for id in ids {
    instances.push(load_instance(id, state.clone())?);
  }

  let org = meta.organization.clone();
  let period = if !meta.period_end.is_empty() {
    meta.period_end.clone()
  } else {
    meta.period_start.clone()
  };
  let payload = serde_json::json!({
    "version": "1.2",
    "exportedAt": iso_now(),
    "organization": org,
    "periodStart": meta.period_start,
    "periodEnd": meta.period_end,
    "zid": meta.zid,
    "eid": meta.eid,
    "instanceCount": instances.len(),
    "instances": instances,
  });

  with_package(&state, |pkg| {
    let exports = pkg.folder.join("exports");
    fs::create_dir_all(&exports)
      .map_err(|e| AppError::Message(format!("mkdir exports failed: {e}")))?;
    let safe_org: String = org
      .chars()
      .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
      .take(30)
      .collect();
    let safe_period: String = period.chars().filter(|c| c.is_ascii_digit()).take(8).collect();
    let name = format!(
      "oko_package_{}_{}.json",
      if safe_org.is_empty() { "oko".into() } else { safe_org },
      if safe_period.is_empty() {
        "report".into()
      } else {
        safe_period
      }
    );
    let dest = exports.join(name);
    let raw = serde_json::to_string_pretty(&payload)
      .map_err(|e| AppError::Message(format!("serialize export failed: {e}")))?;
    fs::write(&dest, raw + "\n")
      .map_err(|e| AppError::Message(format!("write export failed: {e}")))?;
    let dest_s = dest.display().to_string();
    insert_audit(
      &pkg.conn,
      "export_json",
      None,
      None,
      None,
      &actor,
      Some(&dest_s),
    )?;
    // silence unused folder from outer
    let _ = folder;
    Ok(dest_s)
  })
}

#[tauri::command]
fn import_package_json(
  file_path: String,
  actor: String,
  pin: Option<String>,
  mode: Option<String>,
  state: State<'_, AppState>,
) -> Result<usize, AppError> {
  let skip_existing = mode.as_deref() == Some("skip");
  let raw = fs::read_to_string(&file_path)
    .map_err(|e| AppError::Message(format!("read import file failed: {e}")))?;
  let value: Value = serde_json::from_str(&raw)
    .map_err(|e| AppError::Message(format!("Некорректный JSON комплекта: {e}")))?;
  let instances = value
    .get("instances")
    .and_then(|v| v.as_array())
    .ok_or_else(|| AppError::Message("В файле нет instances[]".into()))?;

  with_package(&state, |pkg| {
    assert_coordinator_pin(pkg, pin.as_deref())?;
    Ok(())
  })?;

  let mut count = 0usize;
  let rules = value.get("rules").cloned();

  for inst_val in instances {
    let mut inst: OkoFormInstance = serde_json::from_value(inst_val.clone())
      .map_err(|e| AppError::Message(format!("instance parse failed: {e}")))?;

    let existing_id: Option<String> = with_package(&state, |pkg| {
      pkg
        .conn
        .query_row(
          "SELECT instance_id FROM form_instances WHERE template_id = ?1 LIMIT 1",
          params![inst.template_id],
          |row| row.get(0),
        )
        .optional()
        .map_err(|e| AppError::Message(format!("lookup template failed: {e}")))
    })?;

    if existing_id.is_some() && skip_existing {
      continue;
    }
    if let Some(id) = existing_id {
      inst.instance_id = id;
    }

    with_package(&state, |pkg| {
      if inst.zid.is_none() {
        inst.zid = Some(pkg.meta.zid);
      }
      if inst.eid.is_none() {
        inst.eid = Some(pkg.meta.eid);
      }
      if inst.meta.organization.is_empty() {
        inst.meta.organization = pkg.meta.organization.clone();
      }
      Ok(())
    })?;
    save_instance(inst, state.clone())?;
    count += 1;
  }

  if let Some(rules_val) = rules {
    with_package(&state, |pkg| {
      let write_meta = |key: &str, v: &Value| -> Result<(), AppError> {
        let s = serde_json::to_string(v)
          .map_err(|e| AppError::Message(format!("rules serialize failed: {e}")))?;
        pkg
          .conn
          .execute(
            r#"INSERT INTO app_meta (key, value) VALUES (?1, ?2)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value"#,
            params![key, s],
          )
          .map_err(|e| AppError::Message(format!("app_meta write failed: {e}")))?;
        Ok(())
      };
      if let Some(v) = rules_val.get("checks") {
        write_meta("rules_checks", v)?;
      }
      if let Some(v) = rules_val.get("rash") {
        write_meta("rules_rash", v)?;
      }
      if let Some(v) = rules_val.get("recalc") {
        write_meta("rules_recalc", v)?;
      }
      if let Some(v) = rules_val.get("rowFormulas") {
        write_meta("rules_row_formulas", v)?;
      }
      if let Some(v) = rules_val.get("kontr") {
        write_meta("rules_kontr", v)?;
      }
      let exported = rules_val
        .get("exportedAt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
      let exported = if exported.is_empty() {
        iso_now()
      } else {
        exported
      };
      pkg
        .conn
        .execute(
          r#"INSERT INTO app_meta (key, value) VALUES ('rules_exported_at', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value"#,
          params![exported],
        )
        .map_err(|e| AppError::Message(format!("app_meta write failed: {e}")))?;
      Ok(())
    })?;
  }

  with_package(&state, |pkg| {
    insert_audit(
      &pkg.conn,
      "import_package",
      None,
      None,
      None,
      &actor,
      Some(&file_path),
    )?;
    Ok(())
  })?;

  Ok(count)
}

#[tauri::command]
fn list_package_editors(state: State<'_, AppState>) -> Result<serde_json::Map<String, Value>, AppError> {
  with_package(&state, |pkg| {
    let cfg = collaboration_settings_from_meta(&pkg.meta);
    prune_stale_presence(&pkg.conn, cfg.presence_stale_sec)?;
    let cutoff = stale_cutoff(cfg.presence_stale_sec);
    let mut stmt = pkg
      .conn
      .prepare(
        r#"SELECT DISTINCT instance_id, user_name FROM cell_presence
           WHERE heartbeat_at >= ?1"#,
      )
      .map_err(|e| AppError::Message(format!("prepare editors failed: {e}")))?;
    let rows = stmt
      .query_map(params![cutoff], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
      })
      .map_err(|e| AppError::Message(format!("query editors failed: {e}")))?;
    let mut map: serde_json::Map<String, Value> = serde_json::Map::new();
    for r in rows {
      let (instance_id, user_name) = r.map_err(|e| AppError::Message(format!("row failed: {e}")))?;
      let entry = map
        .entry(instance_id)
        .or_insert_with(|| Value::Array(vec![]));
      if let Some(arr) = entry.as_array_mut() {
        let name = Value::String(user_name);
        if !arr.contains(&name) {
          arr.push(name);
        }
      }
    }
    Ok(map)
  })
}

#[tauri::command]
fn create_empty_package(
  folder_path: String,
  zid: i64,
  eid: i64,
  organization: String,
  period_start: String,
  period_end: String,
  enterprise_code: String,
  state: State<'_, AppState>,
) -> Result<OpenPackageResult, AppError> {
  let folder = PathBuf::from(&folder_path);
  fs::create_dir_all(&folder)
    .map_err(|e| AppError::Message(format!("mkdir package failed: {e}")))?;
  let meta = PackageMeta {
    format_version: 1,
    zid,
    eid,
    organization,
    period_start,
    period_end,
    enterprise_code: Some(enterprise_code),
    created_at: Some(iso_now()),
    settings: Some(MetaSettings {
      heartbeat_interval_sec: Some(5),
      presence_stale_sec: Some(30),
      sync_poll_interval_sec: Some(3),
      restrict_executors_to_assignments: Some(false),
    }),
    coordinator_pin_hash: None,
  };
  write_package_meta(&folder, &meta)?;
  write_schema_version(&folder)?;

  let db_path = folder.join("oko.db");
  if db_path.exists() {
    return Err(AppError::Message(
      "В папке уже есть oko.db — выберите пустую папку или откройте комплект".into(),
    ));
  }
  let conn = Connection::open(&db_path)
    .map_err(|e| AppError::Message(format!("create db failed: {e}")))?;
  conn
    .execute_batch(
      r#"
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE form_instances (
        instance_id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        zid INTEGER,
        eid INTEGER,
        display_name TEXT NOT NULL,
        organization TEXT,
        period_start TEXT,
        period_end TEXT,
        unit TEXT DEFAULT 'тыс.руб.',
        status TEXT DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        template_title TEXT,
        enterprise_code TEXT,
        signatures_json TEXT DEFAULT '{}',
        rash_entries_json TEXT DEFAULT '[]'
      );
      CREATE TABLE form_cell_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        row_no INTEGER NOT NULL,
        row_name TEXT,
        column_key TEXT NOT NULL,
        value_num REAL,
        value_text TEXT,
        updated_at TEXT,
        updated_by TEXT,
        updated_client_id TEXT,
        UNIQUE (instance_id, row_no, column_key),
        FOREIGN KEY (instance_id) REFERENCES form_instances(instance_id) ON DELETE CASCADE
      );
      "#,
    )
    .map_err(|e| AppError::Message(format!("init schema failed: {e}")))?;
  // reopen via open_db for presence migration
  drop(conn);
  let conn = open_db(&db_path)?;
  let instances = count_instances(&conn)?;
  let result = OpenPackageResult {
    folder_path: folder.display().to_string(),
    meta: meta.clone(),
    db_path: db_path.display().to_string(),
    instances,
    has_coordinator_pin: false,
    restrict_executors_to_assignments: false,
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
fn write_text_file(path: String, content: String) -> Result<bool, AppError> {
  if let Some(parent) = Path::new(&path).parent() {
    let _ = fs::create_dir_all(parent);
  }
  fs::write(&path, content).map_err(|e| AppError::Message(format!("write failed: {e}")))?;
  Ok(true)
}

#[tauri::command]
fn get_os_user_name() -> String {
  std::env::var("USERNAME")
    .or_else(|_| std::env::var("USER"))
    .unwrap_or_else(|_| "user".into())
}

#[tauri::command]
fn append_app_log(level: String, message: String) -> Result<bool, AppError> {
  // Do not log cell values — callers must keep messages free of field contents.
  let dir = logs_dir();
  fs::create_dir_all(&dir).map_err(|e| AppError::Message(format!("mkdir logs failed: {e}")))?;
  let path = dir.join("renderer.log");
  let line = format!("{}\t{}\t{}\n", iso_now(), level, message.replace('\n', " "));
  use std::io::Write;
  let mut f = fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(&path)
    .map_err(|e| AppError::Message(format!("open log failed: {e}")))?;
  f.write_all(line.as_bytes())
    .map_err(|e| AppError::Message(format!("write log failed: {e}")))?;
  Ok(true)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, AppError> {
  fs::read_to_string(&path).map_err(|e| AppError::Message(format!("read failed: {e}")))
}

#[tauri::command]
fn write_bytes_file(path: String, bytes: Vec<u8>) -> Result<bool, AppError> {
  if let Some(parent) = Path::new(&path).parent() {
    let _ = fs::create_dir_all(parent);
  }
  fs::write(&path, bytes).map_err(|e| AppError::Message(format!("write failed: {e}")))?;
  Ok(true)
}

#[tauri::command]
fn copy_file(from: String, to: String) -> Result<bool, AppError> {
  if let Some(parent) = Path::new(&to).parent() {
    let _ = fs::create_dir_all(parent);
  }
  fs::copy(&from, &to).map_err(|e| AppError::Message(format!("copy failed: {e}")))?;
  Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(AppState {
      package: Mutex::new(None),
      client_id: uuid::Uuid::new_v4().to_string(),
      machine_name: machine_name(),
    })
    .invoke_handler(tauri::generate_handler![
      runtime_info,
      open_package,
      close_package,
      list_instance_ids,
      list_summaries,
      load_instance,
      save_instance,
      get_client_id,
      get_collaboration_settings,
      claim_cell,
      release_presence,
      heartbeat_cell,
      list_instance_presence,
      list_cell_changes,
      save_cell,
      get_assignments,
      save_assignments,
      list_known_assignees,
      has_coordinator_pin,
      verify_coordinator_pin,
      set_coordinator_pin,
      set_restrict_executors,
      set_instance_status,
      backup_database,
      force_unlock,
      export_package_json,
      import_package_json,
      list_package_editors,
      create_empty_package,
      write_text_file,
      read_text_file,
      write_bytes_file,
      copy_file,
      get_os_user_name,
      append_app_log
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
