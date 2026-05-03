export function renderHeader(host: HTMLElement, agentId: string, domain: string): void {
  const header = document.createElement("header");
  header.className = "header";
  
  header.innerHTML = `
    <h1 class="header__title">Interpretable <em>AutoResearch</em></h1>
    <p class="header__subtitle">${agentId} · ${domain}</p>
  `;
  
  host.appendChild(header);
}
