import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficialTftEntityDetails,
  decodeOfficialTftHtml,
  fetchOfficialTftEntityDetails
} from "../src/index.js";

const chess = {
  version: "16.14",
  season: "2026.S17",
  time: "2026-07-15 16:27:53",
  data: [{
    chessId: "100224",
    displayName: "易",
    price: "4",
    skillName: "灵能打击",
    skillType: "主动",
    skillImage: "https://example.test/yi-skill.png",
    skillIntroduce: "<spellPassive>被动：</spellPassive>每第三次攻击。<br><spellActive>主动：</spellActive>造成伤害。",
    life: "1100",
    magic: "60",
    startMagic: "20",
    armor: "65",
    spellBlock: "65",
    attack: "60",
    attackSpeed: "0.85",
    attackRange: "1",
    crit: "25",
    attackData: "60/90/135",
    lifeData: "1100/1980/3564",
    hero_EN_name: "TFT17_MasterYi",
    chessRole: "物理战士",
    races: "灵能特工",
    jobs: "狂战士"
  }]
};

const job = {
  version: "16.14",
  data: [{
    jobId: "10298",
    name: "挑战者",
    introduce: "你的队伍获得10%攻击速度。",
    level: {
      2: "<row>(2) 15% %i:scaleAS%</row>",
      4: "<row>(4) 30% %i:scaleAS%</row>"
    },
    characterid: "TFT17_ASTrait",
    imagePath: "https://example.test/challenger.png"
  }]
};

const darkStarRace = {
  version: "16.14",
  data: [{
    raceId: "10304",
    name: "暗星",
    characterid: "TFT17_DarkStar",
    level: {
      2: "<row>(2) 【暗星】创造【黑洞】，【黑洞】会吞噬最大生命值低于<ShowIf.TFT17_DarkStar_HasNeutronStar><TFTBonus>@TFTUnitProperty.trait:TFT17_Augment_DarkStar_NeutronStar_BonusExecutePercent*100@%</TFTBonus></ShowIf.TFT17_DarkStar_HasNeutronStar><ShowIfNot.TFT17_DarkStar_HasNeutronStar>8%</ShowIfNot.TFT17_DarkStar_HasNeutronStar>的敌人。</row>"
    }
  }]
};

test("official entity details decode unit stats, abilities, and trait tiers", () => {
  const details = buildOfficialTftEntityDetails({ chess, race: { data: [] }, job });
  const unit = details.units.get("TFT17_MasterYi");
  const trait = details.traits.get("TFT17_ASTrait");
  assert.equal(unit.name, "易");
  assert.equal(unit.stats.health, 1100);
  assert.deepEqual(unit.stats.healthByStar, [1100, 1980, 3564]);
  assert.equal(unit.ability.name, "灵能打击");
  assert.match(unit.ability.description, /被动：每第三次攻击/);
  assert.deepEqual(unit.traitNames, ["灵能特工", "狂战士"]);
  assert.equal(trait.name, "挑战者");
  assert.deepEqual(trait.levels, [
    { units: 2, effect: "(2) 15% 攻击速度" },
    { units: 4, effect: "(4) 30% 攻击速度" }
  ]);
  assert.equal(details.meta.version, "16.14");
  assert.equal(decodeOfficialTftHtml("<b>效果</b><br>&amp; 属性"), "效果\n& 属性");
});

test("official trait details select the static default branch instead of leaking runtime tokens", () => {
  const details = buildOfficialTftEntityDetails({
    chess: { data: [] },
    race: darkStarRace,
    job: { data: [] }
  });
  const darkStar = details.traits.get("TFT17_DarkStar");

  assert.deepEqual(darkStar.levels, [{
    units: 2,
    effect: "(2) 【暗星】创造【黑洞】，【黑洞】会吞噬最大生命值低于8%的敌人。"
  }]);
  assert.doesNotMatch(darkStar.levels[0].effect, /TFTUnitProperty|ShowIf|@/u);
});

test("official entity details fetch all three official catalogs", async () => {
  const requested = [];
  const payloads = [chess, { version: "16.14", data: [] }, job];
  const details = await fetchOfficialTftEntityDetails({
    fetchImpl: async (url) => {
      requested.push(url);
      const payload = payloads[requested.length - 1];
      return { ok: true, text: async () => JSON.stringify(payload) };
    }
  });
  assert.equal(requested.length, 3);
  assert.equal(details.units.has("TFT17_MasterYi"), true);
  assert.equal(details.traits.has("TFT17_ASTrait"), true);
});
