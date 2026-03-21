// Test script for HTML route testing
document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("app");
  if (el) {
    el.textContent = "JavaScript loaded successfully!";
  }
  // eslint-disable-next-line no-console -- test fixture
  console.log("bun-serve-compress test app loaded");
});
