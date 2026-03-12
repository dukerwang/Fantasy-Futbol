const VERCEL = "https://fantasy-futbol-tau.vercel.app";

async function poll() {
    console.log("Polling Vercel deployment...");
    for (let i = 0; i < 15; i++) { // Wait up to 75 seconds for deployment
        try {
            const res = await fetch(`${VERCEL}/api/test-scoring`);
            if (res.ok) {
                const data = await res.json();
                console.log(JSON.stringify(data, null, 2));
                return;
            }
            console.log(`Still deploying... (${res.status})`);
        } catch (e) {
            console.log("Error hitting route...");
        }
        await new Promise(r => setTimeout(r, 5000));
    }
    console.log("Timed out waiting for Vercel.");
}
poll();
