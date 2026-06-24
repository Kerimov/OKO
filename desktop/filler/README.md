# ОКО Заполнение (desktop/filler)

Десктопное приложение для дочерних организаций.

## Сборка (Windows)

```bash
cd desktop/filler
npm install
npm run dist
```

Результат — **portable**-файл (запуск без установки):

```
installer/OKO-Zapolnenie-0.1.0.exe
```

Скопируйте на рабочий стол или в `C:\Program Files\OKO\` и запускайте двойным щелчком.

### Другие варианты сборки

| Команда | Результат |
|---------|-----------|
| `npm run dist` | `installer/OKO-Zapolnenie-0.1.0.exe` — portable (без установки) |
| `npm run dist:setup` | **`installer/OKO-Zapolnenie-Setup-0.1.0.exe`** — установщик NSIS |
| `npm run dist:dir` | `installer/win-unpacked/` — папка с exe |

Если `npm run dist` падает с `EBUSY` — закройте «ОКО Заполнение» и повторите.

## Работа в приложении

1. Запустите **OKO-Zapolnenie-0.1.0.exe**
2. Укажите папку комплекта
3. Открыть / Создать / Импорт JSON от ЦО
4. Заполняйте формы → Экспорт JSON для ЦО

## Разработка

```bash
npm run dev
```
