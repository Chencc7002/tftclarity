import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInlineEntityMatcher,
  decorateInlineEntityIcons
} from "../src/app/small-window-ui/inline-entity-icons.js";
import {
  createSmallWindowRuntime,
  handleItemIconsRequest
} from "../src/app/small-window-server.js";
import { createCatalog } from "../src/index.js";

function createFakeDom(initialChildren) {
  class FakeNode {
    constructor(type, value = "") {
      this.nodeType = type;
      this.nodeValue = value;
      this.parentElement = null;
      this.childNodes = [];
    }
    get textContent() {
      if (this.nodeType === 3) return this.nodeValue;
      return this.childNodes.map((child) => child.textContent).join("");
    }
    replaceWith(fragment) {
      const parent = this.parentElement;
      const index = parent.childNodes.indexOf(this);
      const inserted = fragment.childNodes;
      for (const node of inserted) node.parentElement = parent;
      parent.childNodes.splice(index, 1, ...inserted);
    }
  }

  class FakeElement extends FakeNode {
    constructor(tagName, className = "") {
      super(1);
      this.tagName = tagName.toUpperCase();
      this.className = className;
      this.dataset = {};
      this.attributes = {};
      this.listeners = new Map();
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    dispatch(type) { this.listeners.get(type)?.(); }
    remove() {
      const parent = this.parentElement;
      if (!parent) return;
      const index = parent.childNodes.indexOf(this);
      if (index >= 0) parent.childNodes.splice(index, 1);
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parentElement = this;
        this.childNodes.push(node);
      }
    }
    matchesSelector(selector) {
      for (const part of selector.split(",").map((item) => item.trim()).filter(Boolean)) {
        if (part.startsWith(".")) {
          if (this.className.split(/\s+/).includes(part.slice(1))) return true;
        } else if (!part.includes(" ") && this.tagName.toLowerCase() === part.toLowerCase()) {
          return true;
        }
      }
      return false;
    }
    closest(selector) {
      let current = this;
      while (current) {
        if (current.matchesSelector?.(selector)) return current;
        current = current.parentElement;
      }
      return null;
    }
    querySelectorAll(className) {
      const results = [];
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (child.className.split(/\s+/).includes(className)) results.push(child);
            walk(child);
          }
        }
      };
      walk(this);
      return results;
    }
  }

  const doc = {
    defaultView: { NodeFilter: { SHOW_TEXT: 4 } },
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeNode(3, text),
    createDocumentFragment: () => new FakeElement("#fragment"),
    createTreeWalker: (root) => {
      const list = [];
      const visit = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 3) list.push(child);
          else visit(child);
        }
      };
      visit(root);
      let cursor = -1;
      return {
        nextNode() {
          cursor += 1;
          return list[cursor] ?? null;
        }
      };
    }
  };

  const root = new FakeElement("div", "assistant-rich-text");
  root.ownerDocument = doc;
  for (const child of initialChildren(doc, FakeElement)) {
    root.append(child);
  }
  return { doc, root };
}

const SAMPLE_CATALOG = [
  { entityType: "unit", apiName: "DA_DrMundo19", name: "蒙多医生", enName: "DrMundo19", iconUrl: "https://cdn.metatft.com/file/metatft/champions/da_drmundo19.png" },
  { entityType: "item", apiName: "DA_GargoyleStoneplate", name: "石像鬼石板甲", aliases: ["石像鬼", "板甲"], iconUrl: "https://cdn.metatft.com/file/metatft/items/da_gargoylestoneplate.png" },
  { entityType: "item", apiName: "DA_GargoyleStoneplate_Radiant", name: "光明版石像鬼石板甲", aliases: ["光明石像鬼"], iconUrl: "https://cdn.metatft.com/file/metatft/items/da_gargoylestoneplate_radiant.png" },
  { entityType: "item", apiName: "DA_SpiritVisage", name: "振奋盔甲", aliases: ["振奋盔甲"], iconUrl: "https://cdn.metatft.com/file/metatft/items/da_spiritvisage.png" },
  { entityType: "item", apiName: "DA_SpiritVisage_Radiant", name: "光明版振奋盔甲", aliases: ["光明振奋", "光明振奋盔甲"], iconUrl: "https://cdn.metatft.com/file/metatft/items/da_spiritvisage_radiant.png" },
  { entityType: "item", apiName: "DA_WarmogsArmor", name: "狂徒铠甲", aliases: ["狂徒"], iconUrl: "https://cdn.metatft.com/file/metatft/items/da_warmogsarmor.png" },
  { entityType: "item", apiName: "DA_WarmogsArmor_Radiant", name: "光明版狂徒铠甲", aliases: ["光明狂徒"], iconUrl: "https://cdn.metatft.com/file/metatft/items/da_warmogsarmor_radiant.png" },
  { entityType: "item", apiName: "DA_Crownguard", name: "冕卫", aliases: ["冕卫"], iconUrl: "https://cdn.metatft.com/file/metatft/items/da_crownguard.png" },
  { entityType: "item", apiName: "DA_Artifact_MogulsMail", name: "大亨之铠", aliases: ["大亨之铠"], iconUrl: "https://cdn.metatft.com/file/metatft/items/da_artifact_mogulsmail.png" },
  { entityType: "item", apiName: "DA_Artifact_TheIndomitable", name: "顽强不屈", aliases: ["顽强不屈"], iconUrl: "https://cdn.metatft.com/file/metatft/items/da_artifact_theindomitable.png" },
  { entityType: "item", apiName: "DA_Artifact_AegisOfDawn", name: "黎明圣盾", aliases: ["黎明盾"], iconUrl: "https://cdn.metatft.com/file/metatft/items/da_artifact_aegisofdawn.png" },
  { entityType: "trait", apiName: "DA_EDM19", name: "电子舞曲", aliases: ["电子舞曲"], iconUrl: "https://cdn.metatft.com/file/metatft/traits/da_edm19.png" }
];

test("inline entity icons decorate every occurrence with longest-match priority and preserve exact text", () => {
  const matcher = buildInlineEntityMatcher(SAMPLE_CATALOG);
  const originalText = [
    "蒙多医生（2星，近3天铂金以上，PBE）：普通装主流为石像鬼+振奋盔甲+狂徒（前四73.8%，样本6254）；",
    "备选冕卫+石像鬼+振奋盔甲（前四75.0%，样本2508）。",
    "神器首选大亨之铠（前四69.0%，样本1116），其次顽强不屈、黎明盾。",
    "光明装首选光明狂徒（前四75.6%，样本131），其次光明石像鬼、光明振奋。"
  ].join("\n");

  const { root } = createFakeDom((doc, FakeElement) => {
    const p = new FakeElement("p");
    p.append(doc.createTextNode(originalText));
    return [p];
  });

  const count = decorateInlineEntityIcons(root, matcher);
  assert.equal(count, 13);
  assert.equal(root.textContent, originalText);

  const decorated = root.querySelectorAll("entity-inline");
  assert.deepEqual(
    decorated.map((el) => [el.textContent, el.dataset.entityId]),
    [
      ["蒙多医生", "DA_DrMundo19"],
      ["石像鬼", "DA_GargoyleStoneplate"],
      ["振奋盔甲", "DA_SpiritVisage"],
      ["狂徒", "DA_WarmogsArmor"],
      ["冕卫", "DA_Crownguard"],
      ["石像鬼", "DA_GargoyleStoneplate"],
      ["振奋盔甲", "DA_SpiritVisage"],
      ["大亨之铠", "DA_Artifact_MogulsMail"],
      ["顽强不屈", "DA_Artifact_TheIndomitable"],
      ["黎明盾", "DA_Artifact_AegisOfDawn"],
      ["光明狂徒", "DA_WarmogsArmor_Radiant"],
      ["光明石像鬼", "DA_GargoyleStoneplate_Radiant"],
      ["光明振奋", "DA_SpiritVisage_Radiant"]
    ]
  );

  // Idempotent on second pass and gracefully removes broken img without altering text
  assert.equal(decorateInlineEntityIcons(root, matcher), 0);
  const firstIcon = decorated[0].childNodes[0];
  assert.equal(firstIcon.alt, "");
  assert.equal(firstIcon.attributes["aria-hidden"], "true");
  firstIcon.dispatch("error");
  assert.equal(decorated[0].childNodes.length, 1);
  assert.equal(root.textContent, originalText);
});

test("inline entity icons skip code, buttons, links, and existing item pills", () => {
  const matcher = buildInlineEntityMatcher(SAMPLE_CATALOG);
  const { root } = createFakeDom((doc, FakeElement) => {
    const code = new FakeElement("code");
    code.append(doc.createTextNode("石像鬼"));
    const button = new FakeElement("button");
    button.append(doc.createTextNode("蒙多医生"));
    const pill = new FakeElement("span", "item");
    pill.append(doc.createTextNode("狂徒"));
    const plain = new FakeElement("p");
    plain.append(doc.createTextNode("电子舞曲配合狂徒"));
    return [code, button, pill, plain];
  });

  const count = decorateInlineEntityIcons(root, matcher);
  assert.equal(count, 2);
  assert.deepEqual(
    root.querySelectorAll("entity-inline").map((el) => el.dataset.entityType),
    ["trait", "item"]
  );
});

test("inline entity icons skip icon-bearing comparison headers and deduplicate repeated prose mentions", () => {
  const matcher = buildInlineEntityMatcher(SAMPLE_CATALOG);
  const { root } = createFakeDom((doc, FakeElement) => {
    const comparisonName = new FakeElement("div", "comparison-name");
    const existingImg = new FakeElement("img");
    const titleWrap = new FakeElement("div");
    const title = new FakeElement("div", "card-title");
    title.append(doc.createTextNode("狂徒"));
    titleWrap.append(title);
    comparisonName.append(existingImg, titleWrap);

    const conclusion = new FakeElement("section", "generated-conclusion");
    const h3 = new FakeElement("h3");
    h3.append(doc.createTextNode("蒙多医生使用狂徒时高于石像鬼，狂徒胜出。"));
    const p2 = new FakeElement("p");
    p2.append(doc.createTextNode("狂徒与石像鬼样本均稳定，优先给蒙多医生配狂徒或振奋盔甲。"));
    conclusion.append(h3, p2);

    return [comparisonName, conclusion];
  });

  const count = decorateInlineEntityIcons(root, matcher);
  // 4 distinct entities in conclusion-card (蒙多医生, 狂徒, 石像鬼, 振奋盔甲); comparison-name skipped.
  assert.equal(count, 4);
  assert.deepEqual(
    root.querySelectorAll("entity-inline").map((el) => el.textContent),
    ["蒙多医生", "狂徒", "石像鬼", "振奋盔甲"]
  );
});

test("handleItemIconsRequest derives short radiant aliases from the base item in the same season", async () => {
  const catalog = createCatalog({
    units: [],
    items: [
      { apiName: "DA_SpiritVisage", zhName: "振奋盔甲", shortName: "振奋", aliases: ["绿甲"], category: "normal", current: true },
      { apiName: "DA_SpiritVisage_Radiant", zhName: "光明版振奋盔甲", aliases: [], category: "radiant", current: true }
    ]
  });
  const runtime = createSmallWindowRuntime({ catalog, fetchItems: false });
  const payload = await handleItemIconsRequest(runtime, "set19-pbe");
  const radiant = payload.items.find((item) => item.apiName === "DA_SpiritVisage_Radiant");
  assert.ok(radiant);
  assert.ok(radiant.aliases.includes("光明振奋"));
  assert.ok(radiant.aliases.includes("光明振奋盔甲"));
});
