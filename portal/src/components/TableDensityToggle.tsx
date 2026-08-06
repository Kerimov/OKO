import { useEffect, useState } from "react";
import {
  readTableDensity,
  writeTableDensity,
  type TableDensity,
} from "../tableDensity";

type Props = {
  value: TableDensity;
  onChange: (value: TableDensity) => void;
  className?: string;
};

export function TableDensityToggle({ value, onChange, className = "" }: Props) {
  return (
    <div
      className={`table-density-toggle ${className}`.trim()}
      role="group"
      aria-label="Плотность таблицы"
    >
      <button
        type="button"
        className={value === "normal" ? "is-active" : ""}
        onClick={() => onChange("normal")}
        title="Обычная плотность"
      >
        Обычный
      </button>
      <button
        type="button"
        className={value === "compact" ? "is-active" : ""}
        onClick={() => onChange("compact")}
        title="Компактная плотность"
      >
        Компактный
      </button>
    </div>
  );
}

export function useTableDensity(): [TableDensity, (v: TableDensity) => void] {
  const [density, setDensity] = useState<TableDensity>(readTableDensity);

  useEffect(() => {
    writeTableDensity(density);
  }, [density]);

  return [density, setDensity];
}
