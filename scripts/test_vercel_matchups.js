const URL = "https://hnkavimrsbytsesdzwvj.supabase.co/rest/v1";
const KEY = "YOUR_SUPABASE_SERVICE_ROLE_KEY";
async function main() {
    let res = await fetch(`${URL}/matchups?id=eq.834ae718-2112-4d16-9771-d397d485b511&select=score_a,score_b,status`, {
        headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}` }
    });
    console.log(await res.json());
}
main();
