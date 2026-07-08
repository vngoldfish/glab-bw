interface PlaceholderPageProps {
  title: string;
  subtitle: string;
}

export default function PlaceholderPage({ title, subtitle }: PlaceholderPageProps) {
  return (
    <div className="placeholder-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>{title}</h1>
          <span className="pill pill-purple">Sắp ra mắt</span>
        </div>
      </header>
      <section className="panel-card">
        <p>{subtitle}</p>
      </section>
    </div>
  );
}