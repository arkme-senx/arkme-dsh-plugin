export const reactionPhrasePalette = [
  { id: 'peach', name: '蜜桃橙', color: '#9b4827', background: '#fae2d7', border: '#f4c2ad' },
  { id: 'purple', name: '浅紫', color: '#5d4fb0', background: '#e1e2f7', border: '#c9caf0' },
  { id: 'rose', name: '玫瑰粉', color: '#ac304b', background: '#fbd8dc', border: '#f7b8c0' },
  { id: 'mint', name: '薄荷绿', color: '#087756', background: '#d0f0e7', border: '#aae4d3' },
  { id: 'blue', name: '天空蓝', color: '#2365ad', background: '#d4e8fd', border: '#b1d5fb' },
  { id: 'gold', name: '奶油金', color: '#806632', background: '#f4eee0', border: '#ebe0c7' },
  { id: 'cyan', name: '湖水青', color: '#1f7080', background: '#d8eff5', border: '#b7dee9' },
  { id: 'mauve', name: '樱花紫', color: '#884576', background: '#eedfed', border: '#dcc2d9' },
] as const
const defaults: Record<string, string> = {
  '👌 收到': 'blue', '👍 赞同': 'purple', '⏳ 处理中': 'gold', '✅ 已完成': 'mint',
  '💬 稍后回复': 'cyan', '🙏 谢谢': 'rose', '💪 加油': 'peach', '☕ 辛苦了': 'purple',
}
export function phraseColor(label: string, id?: string) {
  const chosen = reactionPhrasePalette.find(value => value.id === (id ?? defaults[label]))
  return chosen ?? reactionPhrasePalette[Array.from(label).reduce((sum, char) => sum + char.codePointAt(0)!, 0) % reactionPhrasePalette.length]!
}
