import { useEffect, useState } from "react";
import { getToken, setToken } from "./api";
import { Games } from "./pages/Games";
import { Game } from "./pages/Game";
import { Leagues } from "./pages/Leagues";
import { Footer } from "./components/Footer";

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
      <span className="mark" aria-hidden>DT</span>
      <h1>Data Is <span style={{ color: "var(--accent)" }}>Truth</span></h1>
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

  if (!authed) return <TokenScreen message={message} onSaved={() => setAuthed(true)} />;

  const gameMatch = route.match(/^#\/game\/(.+)$/);
  return (
    <>
      <header className="topbar">
        <a href="#/" className="brand">
          <span className="mark" aria-hidden>DT</span>
          <span>Data Is <b>Truth</b></span>
        </a>
        <nav>
          <a href="#/" aria-current={route === "#/" || route === "" ? "page" : undefined}>Games</a>
          <a href="#/leagues" aria-current={route === "#/leagues" ? "page" : undefined}>Leagues</a>
          <button className="link" onClick={() => logout()}>Sign out</button>
        </nav>
      </header>
      {gameMatch ? (
        <Game id={decodeURIComponent(gameMatch[1]!)} onUnauthorized={() => logout("That token was not accepted. Enter it again.")} />
      ) : route === "#/leagues" ? (
        <Leagues onUnauthorized={() => logout("That token was not accepted. Enter it again.")} />
      ) : (
        <Games onUnauthorized={() => logout("That token was not accepted. Enter it again.")} />
      )}
    </>
  );
}
