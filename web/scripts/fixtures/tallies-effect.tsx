import { useState } from "react";
import { createRoot } from "react-dom/client";
import Tallies from "../../src/reliquary/Tallies";

const initialApiBase = new URLSearchParams(window.location.search).get("apiBase");
if (!initialApiBase) throw new Error("Tallies effect fixture requires apiBase");

function Fixture() {
  const [apiBase, setApiBase] = useState(initialApiBase);
  const [date, setDate] = useState("2030-01-01");
  return (
    <main>
      <button id="same-date-failure" onClick={() => setApiBase(`${initialApiBase}/fail`)}>
        fail same-date refresh
      </button>
      <button id="next-date-failure" onClick={() => setDate("2030-01-02")}>
        fail next date
      </button>
      <output data-current-date>{date}</output>
      <Tallies apiBase={apiBase} date={date} myWallet="date-a-wallet" />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
