import { useEffect, useState } from "react";
import { getToken, setToken } from "./api";
import { Games } from "./pages/Games";
import { Game } from "./pages/Game";
import { Leagues } from "./pages/Leagues";
import { Picks } from "./pages/Picks";
import { History } from "./pages/History";
import { Footer } from "./components/Footer";
import { isDark, setTheme } from "./theme";
import { BRAND_MARK, BRAND_NAME } from "./brand";

function useRoute(): string {
  const [route, setRoute] = useState(window.location.hash || "#/");
  useEffect(() => {
    const on = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

function TokenScreen({ onSaved, message }: { onSaved: () => void; message?: string }) {
  const [value, setValue] = useState("");
  return (
    <main className="page narrow">
      <span className="mark" aria-hidden>{BRAND_MARK}</span>
      <h1>{BRAND_NAME}<span style={{ color: "var(--accent)" }}>.</span></h1>
      <p className="lead">Personal sports analysis. Enter your access token to continue. It stays in this browser only.</p>
      {message && <p className="error">{message}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) {
            setToken(value.trim());
            onSaved();
          }
        }}
      >
        <label htmlFor="token">Access token</label>
        <input id="token" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit">Continue</button>
      </form>
      <Footer />
    </main>
  );
}

export function App() {
  const route = useRoute();
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [message, setMessage] = useState<string | undefined>();

  const logout = (msg?: string) => {
    setToken("");
    setMessage(msg);
    setAuthed(false);
  };

  const [dark, setDark] = useState(isDark());
  const flipTheme = () => {
    setTheme(isDark() ? "light" : "dark");
    setDark(isDark());
  };

  if (!authed) return <TokenScreen message={message} onSaved={() => setAuthed(true)} />;
  const bad = () => logout("That token was not accepted. Enter it again.");

  const gameMatch = route.match(/^#\/game\/(.+)$/);
  return (
    <>
      <header className="topbar">
        <a href="#/" className="brand">
          <span className="mark" aria-hidden>{BRAND_MARK}</span>
          <span>{BRAND_NAME}<b>.</b></span>
        </a>
        <nav>
          <button className="iconbtn" aria-label="Switch light or dark" onClick={flipTheme}>{dark ? "☀" : "☾"}</button>
          <a href="#/" aria-current={route === "#/" || route === "" ? "page" : undefined}>Picks</a>
          <a href="#/games" aria-current={route === "#/games" ? "page" : undefined}>Games</a>
          <a href="#/history" aria-current={route === "#/history" ? "page" : undefined}>History</a>
          <a href="#/leagues" aria-current={route === "#/leagues" ? "page" : undefined}>More</a>
        </nav>
      </header>
      {gameMatch ? (
        <Game id={decodeURIComponent(gameMatch[1]!)} onUnauthorized={bad} />
      ) : route === "#/leagues" ? (
        <Leagues onUnauthorized={bad} onSignOut={() => logout()} />
      ) : route === "#/games" ? (
        <Games onUnauthorized={bad} />
      ) : route === "#/history" ? (
        <History onUnauthorized={bad} />
      ) : (
        <Picks onUnauthorized={bad} />
      )}
    </>
  );
}
