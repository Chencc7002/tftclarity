export class ResultPane {
  constructor({ root, title }) { this.root = root; this.title = title; }
  setHtml(html) { this.root.innerHTML = html; this.root.scrollTop = 0; }
  focus() { this.root.closest(".result-pane")?.classList.add("result-focus"); this.root.scrollIntoView({ block: "nearest" }); setTimeout(() => this.root.closest(".result-pane")?.classList.remove("result-focus"), 700); }
}

export class RecommendationResult { static type = "recommendation"; }
export class ItemRankingResult { static type = "unit_item_rankings"; }
export class CompRankingResult { static type = "comp_rankings"; }
