/** Safe account-bound references; storage locators and signed URLs stay in the Host. */
export interface ArkmeTeamAvatar {
    mode: 'default' | 'custom';
    key: string;
    imageRef?: string;

}
export interface ArkmeTeamProfile {
    profileRef: string;
    name: string;
    jotmoId: string;
    profileRevision: number;
    canEditProfile: boolean;
    avatar: ArkmeTeamAvatar;
}
export interface ArkmeTeamProfileUpdate {
    expectedRevision: number;
    requestUid: string;
    name?: string;
    avatar?: {
        action: 'default';
    } | {
        action: 'custom';
        uploadRef: string;
    };
}
export interface ArkmeTeamProfileResult {
    requestUid: string;
    acceptedRevision: number;
    profile?: ArkmeTeamProfile;
}
export interface ArkmeTeamProfilePort {
    getTeamProfile(jotmoId: string, signal?: AbortSignal): Promise<ArkmeTeamProfile>;
    updateTeamProfile(profileRef: string, command: ArkmeTeamProfileUpdate, signal?: AbortSignal): Promise<ArkmeTeamProfileResult>;
    uploadTeamAvatar(profileRef: string, contentBase64: string, uploadUid: string, signal?: AbortSignal): Promise<{
        uploadRef: string;
    }>;
    abortTeamAvatar(uploadRef: string, signal?: AbortSignal): Promise<void>;
}
export interface ArkmeTeamProfileToolPort extends ArkmeTeamProfilePort {
    uploadTeamAvatarFile(profileRef: string, fileRef: string, uploadUid: string, signal?: AbortSignal): Promise<{
        uploadRef: string;
    }>;
}
