import type { Domain } from "../types.ts";

export function renderDomainSwitcher(
  host: HTMLElement, 
  currentDomain: Domain, 
  onSwitch: (domain: Domain) => void
): void {
  const switcher = document.createElement("nav");
  switcher.className = "domain-switcher";
  
  const domains: { id: Domain; label: string }[] = [
    { id: "model-training", label: "Model Training" },
    { id: "performance-engineering", label: "Performance Engineering" }
  ];
  
  for (const domain of domains) {
    const btn = document.createElement("button");
    btn.className = `domain-switcher__btn ${domain.id === currentDomain ? "domain-switcher__btn--active" : ""}`;
    btn.textContent = domain.label;
    btn.addEventListener("click", () => onSwitch(domain.id));
    switcher.appendChild(btn);
  }
  
  host.appendChild(switcher);
}
