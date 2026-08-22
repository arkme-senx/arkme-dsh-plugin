const ARKME_BOT_AVATAR_REF_PATTERN = /^file_asset:\/\/[A-Za-z0-9_-]{8,128}$/

/** Bot avatars cross process boundaries only as account-scoped file asset references. */
export function isArkmeBotAvatarRef(value: string): boolean {
  return ARKME_BOT_AVATAR_REF_PATTERN.test(value.trim())
}
