// レシピ生成中のブリューID(ビルド工程と同じインメモリロック方式)。
// 生成中ロックはディスク(recipeProgress)ではなくメモリで持つ。
// クラッシュ時にフラグが残留してブリューが永久ロックされるのを防ぎ、
// 最初の進捗書き込みまでの数msの隙間も塞ぐ(再起動でリセットされるのは許容)。
export const generatingRecipeBrews = new Set<string>();
