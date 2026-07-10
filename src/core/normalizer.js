const CHINESE_DIGITS = new Map([
  ["零", 0],
  ["一", 1],
  ["二", 2],
  ["两", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9]
]);

const TRADITIONAL_TO_SIMPLIFIED = Object.freeze({
  亞: "亚", 來: "来", 個: "个", 們: "们", 優: "优", 備: "备", 傳: "传",
  兩: "两", 內: "内", 凱: "凯", 剩: "剩", 劍: "剑", 動: "动", 勝: "胜",
  區: "区", 單: "单", 參: "参", 問: "问", 圖: "图", 場: "场", 壓: "压",
  奧: "奥", 專: "专", 對: "对", 將: "将", 屬: "属", 峽: "峡", 幫: "帮",
  後: "后", 從: "从", 怎: "怎", 戰: "战", 擇: "择", 擊: "击", 攜: "携",
  數: "数", 斷: "断", 時: "时", 會: "会", 樣: "样", 標: "标", 機: "机",
  歐: "欧", 歸: "归", 殺: "杀", 氣: "气", 無: "无", 為: "为", 點: "点",
  當: "当", 發: "发", 盡: "尽", 穩: "稳", 紅: "红", 級: "级", 組: "组",
  結: "结", 給: "给", 綁: "绑", 維: "维", 線: "线", 編: "编", 織: "织",
  羈: "羁", 習: "习", 聯: "联", 職: "职", 藍: "蓝", 處: "处", 裡: "里",
  裝: "装", 規: "规", 視: "视", 覺: "觉", 覽: "览", 觀: "观", 計: "计",
  訊: "讯", 設: "设", 該: "该", 認: "认", 說: "说", 調: "调", 請: "请",
  輕: "轻", 輸: "输", 這: "这", 進: "进", 運: "运", 過: "过", 遠: "远",
  選: "选", 還: "还", 邊: "边", 錄: "录", 錯: "错", 開: "开", 關: "关",
  階: "阶", 隊: "队", 隻: "只", 離: "离", 電: "电", 靈: "灵", 預: "预",
  類: "类", 顯: "显", 風: "风", 飲: "饮", 餘: "余", 體: "体", 龍: "龙",
  盧: "卢", 颶: "飓", 護: "护", 鎧: "铠", 鋒: "锋", 鏟: "铲", 鉤: "钩",
  鍋: "锅", 義: "义", 陽: "阳", 員: "员", 喚: "唤", 術: "术", 強: "强",
  蘭: "兰", 麗: "丽", 樂: "乐", 爾: "尔", 燼: "烬", 龜: "龟", 嗎: "吗",
  麼: "么", 帶: "带", 已: "已", 經: "经", 補: "补", 齊: "齐", 與: "与",
  於: "于", 寫: "写", 實: "实", 擁: "拥", 資: "资", 總: "总", 擴: "扩"
});

export function normalizeTraditionalChinese(input) {
  return String(input ?? "").replace(/[\p{Script=Han}]/gu, (character) => (
    TRADITIONAL_TO_SIMPLIFIED[character] ?? character
  ));
}

export function normalizeText(input) {
  return normalizeTraditionalChinese(input)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function normalizeAlias(input) {
  return normalizeText(input).replace(/[，。！？?：:；;、,.'"`~\-_/\\()[\]{}<>《》]/g, "");
}

export function digitValue(value) {
  if (value == null) return null;
  const normalized = normalizeText(value);
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return CHINESE_DIGITS.get(normalized) ?? null;
}

export function uniqueValues(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}
