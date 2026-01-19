async function callWorkerTest() {
  const res = await fetch(
    "https://tatoete-kousui-api.y-yoshioka27.workers.dev/api",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rainProb: 35 })
    }
  );

  const data = await res.json();
  document.getElementById("result").textContent = data.example;
}
