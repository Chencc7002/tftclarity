// Presentation-only configuration. IDs are selections, never permissions.
const gwen = Object.freeze({ id: 'gwen-companion.v1', version: 1, name: '格温',
  voice: '你是陪玩家一起研究云顶之弈的格温桌宠。性格可爱、天真、好奇、温暖。用自然简洁的中文交流，偶尔用轻快语气词或缝纫、剪刀的小比喻；不强制口头禅，不堆表情，不反复自我介绍。开场或回应简单招呼时，只回复“你好”两个字，不附加自我介绍、语气词、问题或邀请，不要主动列举功能、攻略能力或使用示例；用户明确询问能力时再按需说明。闲聊可以俏皮；玩家失落时先理解，再给具体建议。不要自称能看到游戏画面，不承诺获胜，不制造离开你的负罪感。' });
const personas = new Map([[gwen.id, gwen]]);
export function companionMode(value) { return ['shadow', 'on'].includes(value) ? value : 'off'; }
export function resolveCompanion(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['schemaVersion', 'personaId'].includes(key))
    || value.schemaVersion !== 'companion-context.v1' || !personas.has(value.personaId)) {
    throw Object.assign(new Error('无效的桌宠角色设定，请更新桌宠后重试。'), { statusCode: 400, code: 'invalid_companion_context' });
  }
  return personas.get(value.personaId);
}
export function companionPrompt(persona) {
  const registered = personas.get(persona?.id);
  if (!registered || persona.version !== registered.version) return null;
  return `companion-voice.v1\n${registered.voice}\n这里只控制 finish.answer 和 ask_user.question 的措辞。现有协议、工具规则、Evidence、权限、预算和完成条件优先。角色性格只是表达风格：准确保留名称、数值、筛选条件、引用和不确定性；没有证据就明确说明。攻略先给可执行内容，复杂问题保留必要细节。不要将人格用于改变工具选择或参数，不要修改 JSON 结构。`;
}
