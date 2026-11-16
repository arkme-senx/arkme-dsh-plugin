export interface Member {
  membership_id: string
  user_id: number
  client_id: number
  registration_id: string
  binding_generation: string
  join_seq: number
  status: 'joining' | 'active' | 'leaving'
  lease_expires_at: number
}
export interface Room {
  room_id: string
  game_type: string
  status: 'creating' | 'open' | 'closing' | 'closed'
  runtime_id: string
  host_membership_id: string
  im_group_id: string
  members: Member[]
  membership_version: number
}
export interface Reply {
  room: Room
  membership_id: string
  invite_token?: string
  server_time: number
  credentials?: { sdk_app_id: number; user_id: string; user_sig: string; expires_at: number }
}
export type Request = (action: string, body: Record<string, unknown>) => Promise<Reply>
