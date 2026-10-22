# Patch localization correction

## Finding

The 18.4 and 18.5 numerical announcements used Riot's Traditional Chinese article for both facts and display names. That article calls `Brambleback` “树精长老”, which is easy for a simplified-Chinese player to mistake for Maokai. They are different Set 18 units:

- `DA_Brambleback18` is the four-cost Riftbeast/Ravager whose simplified-Chinese client name is “绯红印记树怪”;
- `DA_18_Maokai` is the five-cost champion “茂凯”.

The current Riot client Team Planner catalog at `plugins/rcp-be-lol-game-data/global/zh_cn/v1/tftchampions-teamplanner.json` reports `DA_Brambleback18` as tier 4, display name “绯红印记树怪”, with “峡谷野怪” and “狂战士”. The official English 18.5 article identifies the changed unit as Brambleback. Riot's Traditional Chinese 18.5 article places “树精长老” in the four-cost section with the same `4% ⇒ 5%` heal and `20% + 25% AP ⇒ 25% + 25% AP` Armor Ignore values. Together these sources resolve the identity without inferring that it is Maokai.

No separately published or searchable Tencent mainland 18.5 full patch article was found during the 2026-10-22 audit. That absence does not require using Traditional Chinese entity names. Patch facts continue to come from Riot's official English and Traditional Chinese articles, while `zh-CN` entity and trait labels are normalized against the current simplified-Chinese client catalog.

## Correction

The 18.4 and 18.5 announcements now display “绯红印记树怪（Brambleback）” for the four-cost unit. Other directly identifiable Traditional Chinese labels in those releases were normalized to current simplified-Chinese client names, including “永恒之森”, “花仙子”, “峡谷野怪”, “灵魂莲华”, “深红锋喙鸟”, “可酷伯”, and “洛”. Numeric values, directions, entity API names, revision order, evidence schemas, tool routing, and source links are unchanged.

A regression test fixes the identity boundary: the four-cost changes must point to `DA_Brambleback18`, display “绯红印记树怪（Brambleback）”, retain the published endpoints, and never reintroduce “树精长老” in the 18.4 or 18.5 release labels. `DA_18_Maokai` remains the separate unit “茂凯”.

The Agent catalog also preserves the source terms as exact aliases and includes their verified tier costs. “树精长老” resolves to the four-cost `DA_Brambleback18`, while “大树” resolves to the five-cost `DA_18_Maokai`. This mapping runs in the registered deterministic `entity_catalog_query` path before the optional slang resolver, so the model cannot collapse the two units into one guessed candidate or infer that the four-cost Riftbeast is unpurchasable from its monster-like name.
