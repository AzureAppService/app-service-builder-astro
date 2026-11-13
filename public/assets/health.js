const button = document.querySelector("[data-health-check]");
const status = document.querySelector("#health-status");

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Checking the published static health file...";
  try {
    const response = await fetch("/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || (await response.text()).trim() !== "OK") {
      throw new Error("Unexpected health response");
    }
    status.textContent = "The static health file responded successfully. This is not a server or dependency readiness check.";
  } catch {
    status.textContent = "The static health check failed. Retry, then check your Builder App deployment if it still fails.";
  } finally {
    button.disabled = false;
  }
});
