import { getWallets } from "@wallet-standard/app";
import { base58 } from "@scure/base";
import { sha256hex, offeringMessage } from "./offeringMessage";

export interface WalletHandle {
  name: string; icon: string; address: string;
  signMessage(msg: Uint8Array): Promise<Uint8Array>;
}

// Enumerate registered Wallet-Standard wallets that can sign a message on Solana. No generic adapter modal;
// the caller renders our own in-aesthetic picker over these handles.
export async function availableWallets(): Promise<Array<{ name: string; icon: string; connect(): Promise<WalletHandle> }>> {
  const { get } = getWallets();
  return get()
    .filter(w => w.chains.some(c => c.startsWith("solana:")) && "solana:signMessage" in w.features && "standard:connect" in w.features)
    .map(w => ({
      name: w.name, icon: w.icon,
      async connect(): Promise<WalletHandle> {
        const { accounts } = await (w.features["standard:connect"] as any).connect();
        const acc = accounts[0] ?? w.accounts[0];
        const address = acc.address;
        return {
          name: w.name, icon: w.icon, address,
          async signMessage(msg: Uint8Array): Promise<Uint8Array> {
            const [out] = await (w.features["solana:signMessage"] as any).signMessage({ account: acc, message: msg });
            return out.signature as Uint8Array;
          },
        };
      },
    }));
}

// Put the validated preview Blob itself into the multipart body. Signed offerings derive hash bytes from
// that same Blob before the wallet signs; anonymous offerings never need a second copy or encoding.
export async function buildOffering(apiBase: string, image: Blob, wallet: WalletHandle | null): Promise<FormData> {
  const form = new FormData();
  form.set("image", image, "offering.png");
  if (wallet) {
    const bytes = new Uint8Array(await image.arrayBuffer());
    const { nonce, expires_at } = await (await fetch(`${apiBase}/api/nonce`)).json() as { nonce: string; expires_at: number };
    const sha = await sha256hex(bytes);
    const sig = await wallet.signMessage(new TextEncoder().encode(offeringMessage(sha, nonce, expires_at)));
    form.set("wallet", wallet.address);
    form.set("sig", base58.encode(sig));
    form.set("nonce", nonce);
    form.set("expires_at", String(expires_at));
  }
  return form;
}

// POST the built multipart body. 201 = accepted (offering row created); any 4xx is a quiet, honest
// rejection (rate-limited, duplicate, or otherwise not accepted) — never thrown, always rendered.
export async function postOffering(apiBase: string, form: FormData): Promise<{ id: string; status: string } | { error: string; status: number }> {
  const res = await fetch(`${apiBase}/api/offerings`, { method: "POST", body: form });
  if (res.status === 201) return await res.json();
  return { error: (await res.json().catch(() => ({}))).error ?? "rejected", status: res.status };
}
