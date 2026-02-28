
const WebSocket = require("ws");
const ws = new WebSocket("ws://localhost:8000");
ws.on("open", () => {
    console.log("WS Connected. Triggering transfer...");
    fetch("http://localhost:8000/api/characters/char-1771846320586/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 1.5, note: "test WS output" })
    }).then(r=>r.json()).then(d => console.log("HTTP Response:", d));
});
ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    console.log("WS MSG TYPE:", msg.type);
    if (msg.type === "wallet_sync") console.log("WALLET SYNC DATA:", msg.data);
});
setTimeout(() => process.exit(0), 10000);

