export function Footer({ modelVersion }: { modelVersion?: string }) {
  return (
    <footer className="footer">
      <p>
        Analysis only. Nothing is placed through this app. Bookmaker prices include a margin and are set by strong
        models, so a good model may find only a small edge and often none. Every pick is an estimate, never certain.
        Only stake what you can afford to lose, and use licensed operators.
      </p>
      <p className="muted">{modelVersion ? `Model ${modelVersion}. ` : ""}Backtest results: not run yet.</p>
    </footer>
  );
}
