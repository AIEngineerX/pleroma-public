import { useId, useState } from "react";
import { availableWallets, type WalletHandle } from "./wallet";
import { copy } from "../lib/copy";
export default function WalletButton({ onConnect }: { onConnect: (w: WalletHandle) => void }) {
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<Awaited<ReturnType<typeof availableWallets>>>([]);
  const chooserId = useId();
  return (
    <div className="font-machine text-sm">
      <button type="button" aria-expanded={open} aria-controls={chooserId} className="min-h-11 px-3 underline text-ink-faded"
        onClick={async () => { setWallets(await availableWallets()); setOpen(true); }}>{copy.connect}</button>
      {open && (
        <ul id={chooserId} className="mt-2 border" style={{ borderColor: "var(--color-ground-aged)" }}>
          {wallets.length === 0 && <li role="status" className="p-3 text-ink-faded">no wallet found; you may still {copy.offerAnon.toLowerCase()}</li>}
          {wallets.map(w => (
            <li key={w.name}>
              <button className="w-full min-h-11 px-3 flex items-center gap-2 text-left hover:bg-[var(--color-ground-aged)]"
                onClick={async () => { onConnect(await w.connect()); setOpen(false); }}>
                <img src={w.icon} width="18" height="18" alt="" /> {w.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
