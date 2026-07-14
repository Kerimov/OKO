import { Link } from "react-router-dom";
import { MarkdownContent } from "@portal/components/MarkdownContent";
import userGuide from "@portal/content/instructions-user.md?raw";

export function HelpPage() {
  return (
    <div className="content help-page instructions-page">
      <header className="instructions-header">
        <p className="muted" style={{ marginBottom: "0.5rem" }}>
          <Link to="/">← На старт</Link>
          {" · "}
          <Link to="/package">Комплект</Link>
        </p>
        <h1>Справка</h1>
        <p className="instructions-lead">
          Методика заполнения ОКО (как в руководстве пользователя). Ниже — инструкция портала;
          на десктопе те же формы, расшифровки и увязки. Правила переноса сальдо —{" "}
          <Link to="/saldo-rules">просмотр</Link>
          {" "}(правка на портале `/admin/saldo`). Для ЦО (сальдо-админ, свод, обмен
          комплектами) используйте веб-портал.
        </p>
      </header>
      <article className="instructions-article">
        <MarkdownContent source={userGuide} />
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Особые контрагенты</h2>
          <ul>
            <li>
              <strong>ФИЗИЧЕСКИЕ ЛИЦА</strong> — для расшифровок по физлицам.
            </li>
            <li>
              <strong>ПРОЧИЕ</strong> — в т.ч. индивидуальные предприниматели и суммы ниже порога
              (см. «Другое наименование» / N99 при переименованиях).
            </li>
          </ul>
        </section>
      </article>
    </div>
  );
}
