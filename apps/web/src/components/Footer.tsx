import backtest from "../backtest.json";

const pct = (x: number) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

export function Footer({ modelVersion }: { modelVersion?: string }) {
  const b = backtest;
  return (
    <footer className="footer">
      <p>
        Analysis only. Nothing is placed through this app. Bookmaker prices include a margin and are set by strong
        models, so a good model may find only a small edge and often none. Every pick is an estimate, never certain.
        Only stake what you can afford to lose, and use licensed operators.
      </p>
      <p className="muted">
        {modelVersion ? `Model ${modelVersion}. ` : ""}
        Backtest ({b.ranAt}): {b.matchesScored.toLocaleString()} past games in {b.leagues.length} leagues. Pinnacle's prices
        predicted better than our model alone, so picks follow Pinnacle. Betting the model's "value" picks would have
        returned {b.valueRoiModelOnly === null ? "n/a" : pct(b.valueRoiModelOnly)} per bet.
      </p>
    </footer>
  );
}
