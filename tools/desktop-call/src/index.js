import TencentChat from "@tencentcloud/lite-chat/basic";
import { createIMBridge, imBridgePayload } from "./im-bridge.js";
let sharedIM;
import * as import_call_engine_lite_js from "@trtc/call-engine-lite-js";
// src/tuicallkit-icons.js
var TUICALLKIT_ICONS = {
  accept: String.raw`<svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_22_1697)">
<path d="M4.16182 5.67699C2.58049 7.25832 1.96718 9.60805 2.87395 11.6523C4.44977 15.2049 6.69399 18.5328 9.6066 21.4454C12.5192 24.358 15.8471 26.6022 19.3997 28.1781C21.444 29.0848 23.7937 28.4715 25.375 26.8902L27.9183 24.3469C28.5319 23.7333 28.4984 22.7288 27.8454 22.1574L23.0371 17.9501C22.4428 17.4301 21.5471 17.4599 20.9887 18.0183L18.8577 20.1493C18.6084 20.3986 18.2184 20.4415 17.9262 20.2443C16.5505 19.3161 15.2434 18.2433 14.026 17.026C12.8087 15.8086 11.7359 14.5015 10.8077 13.1258C10.6105 12.8336 10.6534 12.4436 10.9027 12.1943L13.0337 10.0633C13.5921 9.50494 13.6219 8.60923 13.1019 8.01493L8.89464 3.2066C8.32325 2.55359 7.31867 2.52014 6.70511 3.1337L4.16182 5.67699Z" fill="white"/>
</g>
<defs>
<clipPath id="clip0_22_1697">
<rect width="30" height="30" fill="white"/>
</clipPath>
</defs>
</svg>`,
  hangup: String.raw`<svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M30 16.0509C30 13.8146 28.7722 11.7194 26.6855 10.915C23.0591 9.51726 19.119 8.75098 15 8.75098C10.8809 8.75098 6.94086 9.51726 3.31453 10.915C1.22784 11.7194 0 13.8146 0 16.0509V19.6476C0 20.5153 0.734003 21.202 1.59978 21.1443L7.97478 20.7193C8.76272 20.6668 9.375 20.0123 9.375 19.2226V16.209C9.375 15.8564 9.62034 15.5503 9.96644 15.4831C11.5955 15.1667 13.2784 15.001 15 15.001C16.7216 15.001 18.4045 15.1667 20.0336 15.4831C20.3797 15.5503 20.625 15.8564 20.625 16.209V19.2226C20.625 20.0123 21.2373 20.6668 22.0252 20.7193L28.4002 21.1443C29.266 21.202 30 20.5153 30 19.6476V16.0509Z" fill="white"/>
</svg>`,
  micOn: String.raw`<svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M4 15.625V13.75H6V15.625C6 20.5956 10.0294 24.625 15 24.625C19.9706 24.625 24 20.5956 24 15.625V13.75H26V15.625C26 21.363 21.6065 26.0749 16 26.5802V30H14V26.5802C8.3935 26.0749 4 21.363 4 15.625Z" fill="#22262E"/>
<rect x="8.75" y="1.25" width="12.5" height="20.625" rx="6.25" fill="#22262E"/>
</svg>`,
  micOff: String.raw`<svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M8.75 7.5C8.75 4.04822 11.5482 1.25 15 1.25C16.9758 1.25 18.7376 2.16686 19.8829 3.59834L8.87248 16.8624C8.79215 16.4624 8.75 16.0486 8.75 15.625V7.5ZM6.80567 19.3523C6.28825 18.2166 6 16.9544 6 15.625V13.75H4V15.625C4 17.5882 4.51431 19.4313 5.41555 21.0269L6.80567 19.3523ZM9.21177 24.9807L10.5044 23.4235C11.8272 24.1877 13.3625 24.625 15 24.625C19.9706 24.625 24 20.5956 24 15.625V13.75H26V15.625C26 21.363 21.6065 26.0749 16 26.5802V30H14V26.5802C12.2543 26.4228 10.6262 25.8577 9.21177 24.9807ZM12.2983 21.2625L21.25 10.4784V15.625C21.25 19.0768 18.4518 21.875 15 21.875C14.0323 21.875 13.116 21.6551 12.2983 21.2625Z" fill="white" style="fill:white;fill:white;fill-opacity:1;"/>
<path d="M6.41895 24.084L22.0939 5.20938" stroke="white" style="stroke:white;stroke:white;stroke-opacity:1;" stroke-width="2" stroke-linecap="square" stroke-linejoin="round"/>
</svg>`,
  speakerOn: String.raw`<svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M21.1351 2.37286L22.0007 2.87359C26.1827 5.29275 29 9.81679 29 15C29 20.1833 26.1827 24.7073 22.0007 27.1265L21.1351 27.6272L20.1336 25.896L20.9992 25.3953C24.5887 23.3189 27 19.4405 27 15C27 10.5596 24.5887 6.68117 20.9992 4.6048L20.1336 4.10408L21.1351 2.37286ZM14.6448 3.38893C15.3517 2.86327 16.3556 3.36779 16.3556 4.24869V25.7514C16.3556 26.6323 15.3517 27.1368 14.6448 26.6111L7.9957 21.6665C7.81087 21.529 7.58667 21.4548 7.35634 21.4548H2.2516C1.65987 21.4548 1.18018 20.9751 1.18018 20.3834V9.63411C1.18018 9.04371 1.65779 8.56457 2.24819 8.56269L7.35824 8.54639C7.5874 8.54566 7.81029 8.47147 7.99418 8.33472L14.6448 3.38893ZM20.5553 8.1684L19.7237 7.61304L18.613 9.27626L19.4446 9.83162C20.9368 10.8281 22 12.7411 22 15C22 17.2589 20.9368 19.1719 19.4446 20.1684L18.613 20.7238L19.7237 22.387L20.5553 21.8316C22.6499 20.4328 24 17.8688 24 15C24 12.1312 22.6499 9.56717 20.5553 8.1684Z" fill="#2E333D"/>
</svg>`,
  speakerOff: String.raw`<svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M10.3602 22.8416L14.5946 26.4025C15.2916 26.9886 16.3556 26.4931 16.3556 25.5825V15.619L10.3602 22.8416ZM23.7162 6.75187L25.0013 5.20364C27.4741 7.72791 29 11.1855 29 15C29 20.1833 26.1827 24.7073 22.0007 27.1265L21.1351 27.6272L20.1337 25.896L20.9993 25.3953C24.5887 23.3189 27 19.4405 27 15C27 11.806 25.7524 8.90282 23.7162 6.75187ZM20.4377 10.7014L21.7262 9.14917C23.1393 10.6132 24 12.7094 24 15C24 17.8689 22.6499 20.4329 20.5554 21.8316L19.7237 22.387L18.613 20.7238L19.4446 20.1684C20.9369 19.1719 22 17.2589 22 15C22 13.2842 21.3866 11.768 20.4377 10.7014ZM16.3556 6.48288L3.92756 21.4548H2.25164C1.6599 21.4548 1.18021 20.9751 1.18021 20.3834V9.63459C1.18021 9.04401 1.6581 8.56479 2.24867 8.56316L8.32215 8.54636C8.57342 8.54567 8.81646 8.45668 9.00877 8.29496L14.5946 3.59761C15.2916 3.01151 16.3556 3.50699 16.3556 4.41763V6.48288Z" fill="white"/>
<path d="M4.56372 25.2683L22.1407 4.08365" stroke="white" stroke-width="2" stroke-linecap="square" stroke-linejoin="round"/>
</svg>`,
  cameraOn: String.raw`<svg width="26" height="20" viewBox="0 0 26 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M8.9165 8.19978H9.7665V7.34978V5.64978V4.79978H8.9165H4.83317H3.98317V5.64978V7.34978V8.19978H4.83317H8.9165ZM1.0165 1.66662C1.0165 1.58378 1.08366 1.51663 1.1665 1.51663H17.8332C17.916 1.51663 17.9832 1.58378 17.9832 1.66663V18.3333C17.9832 18.4161 17.916 18.4833 17.8332 18.4833H1.1665C1.08366 18.4833 1.0165 18.4161 1.0165 18.3333V1.66662ZM21.2143 5.02224C21.2143 4.96396 21.248 4.91096 21.3008 4.88631L24.7696 3.26756C24.869 3.22115 24.983 3.29375 24.983 3.40349L24.983 16.5964C24.983 16.7062 24.869 16.7788 24.7696 16.7324L21.3008 15.1136C21.248 15.089 21.2143 15.036 21.2143 14.9777L21.2143 5.02224Z" fill="#22262E" stroke="#22262E" stroke-width="1.7" stroke-linecap="round"/>
</svg>`,
  cameraOff: String.raw`<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
<mask id="path-1-inside-1_287_9" fill="white">
<path fill-rule="evenodd" clip-rule="evenodd" d="M9.95191 23.3337H18.8332C19.3855 23.3337 19.8332 22.8859 19.8332 22.3337V11.4298L9.95191 23.3337ZM21.3644 9.58512L22.9896 7.62735L25.4103 6.49767C26.0733 6.18828 26.8332 6.67224 26.8332 7.40385L26.8332 20.5968C26.8332 21.3284 26.0733 21.8124 25.4103 21.503L22.4582 20.1253L21.9416 19.8842C21.5895 19.7199 21.3644 19.3666 21.3644 18.978L21.3644 9.58512ZM17.8631 4.66699L2.36811 23.3337H2.1665C1.61422 23.3337 1.1665 22.8859 1.1665 22.3337V5.66699C1.1665 5.11471 1.61422 4.66699 2.1665 4.66699H17.8631ZM5.83317 11.3501H9.9165V9.65015H5.83317V11.3501Z"/>
</mask>
<path fill-rule="evenodd" clip-rule="evenodd" d="M9.95191 23.3337H18.8332C19.3855 23.3337 19.8332 22.8859 19.8332 22.3337V11.4298L9.95191 23.3337ZM21.3644 9.58512L22.9896 7.62735L25.4103 6.49767C26.0733 6.18828 26.8332 6.67224 26.8332 7.40385L26.8332 20.5968C26.8332 21.3284 26.0733 21.8124 25.4103 21.503L22.4582 20.1253L21.9416 19.8842C21.5895 19.7199 21.3644 19.3666 21.3644 18.978L21.3644 9.58512ZM17.8631 4.66699L2.36811 23.3337H2.1665C1.61422 23.3337 1.1665 22.8859 1.1665 22.3337V5.66699C1.1665 5.11471 1.61422 4.66699 2.1665 4.66699H17.8631ZM5.83317 11.3501H9.9165V9.65015H5.83317V11.3501Z" fill="white" style="fill:white;fill:white;fill-opacity:1;"/>
<path d="M9.95191 23.3337L8.64385 22.2479L6.33138 25.0337H9.95191V23.3337ZM19.8332 11.4298H21.5332V6.72024L18.5251 10.344L19.8332 11.4298ZM22.9896 7.62735L22.2707 6.08684L21.9251 6.24811L21.6815 6.54154L22.9896 7.62735ZM21.3644 9.58512L20.0564 8.49931L19.6644 8.97148L19.6644 9.58512L21.3644 9.58512ZM25.4103 6.49767L26.1292 8.03818L26.1292 8.03818L25.4103 6.49767ZM26.8332 7.40385L28.5332 7.40385V7.40385H26.8332ZM26.8332 20.5968L25.1332 20.5968V20.5968H26.8332ZM25.4103 21.503L24.6914 23.0435L24.6914 23.0435L25.4103 21.503ZM22.4582 20.1253L23.1771 18.5848L23.1771 18.5848L22.4582 20.1253ZM21.9416 19.8842L21.2226 21.4247L21.2227 21.4247L21.9416 19.8842ZM21.3644 18.978L19.6644 18.978V18.978H21.3644ZM2.36811 23.3337V25.0337H3.16633L3.67617 24.4195L2.36811 23.3337ZM17.8631 4.66699L19.1712 5.7528L21.4837 2.96699H17.8631V4.66699ZM9.9165 11.3501V13.0501H11.6165V11.3501H9.9165ZM5.83317 11.3501H4.13317V13.0501H5.83317V11.3501ZM9.9165 9.65015H11.6165V7.95015H9.9165V9.65015ZM5.83317 9.65015V7.95015H4.13317V9.65015H5.83317ZM18.8332 21.6337H9.95191V25.0337H18.8332V21.6337ZM18.1332 22.3337C18.1332 21.9471 18.4466 21.6337 18.8332 21.6337V25.0337C20.3243 25.0337 21.5332 23.8248 21.5332 22.3337H18.1332ZM18.1332 11.4298V22.3337H21.5332V11.4298H18.1332ZM18.5251 10.344L8.64385 22.2479L11.26 24.4195L21.1412 12.5156L18.5251 10.344ZM21.6815 6.54154L20.0564 8.49931L22.6725 10.6709L24.2976 8.71316L21.6815 6.54154ZM24.6914 4.95716L22.2707 6.08684L23.7085 9.16786L26.1292 8.03818L24.6914 4.95716ZM28.5332 7.40385C28.5332 5.42848 26.4815 4.1218 24.6914 4.95716L26.1292 8.03818C25.6651 8.25476 25.1332 7.91599 25.1332 7.40385H28.5332ZM28.5332 20.5968L28.5332 7.40385L25.1332 7.40385L25.1332 20.5968L28.5332 20.5968ZM24.6914 23.0435C26.4814 23.8788 28.5332 22.5722 28.5332 20.5968H25.1332C25.1332 20.0847 25.6651 19.7459 26.1292 19.9625L24.6914 23.0435ZM21.7393 21.6658L24.6914 23.0435L26.1292 19.9625L23.1771 18.5848L21.7393 21.6658ZM21.2227 21.4247L21.7393 21.6658L23.1771 18.5848L22.6605 18.3437L21.2227 21.4247ZM19.6644 18.978C19.6644 20.0271 20.272 20.9811 21.2226 21.4247L22.6605 18.3437C22.9069 18.4587 23.0644 18.7061 23.0644 18.978H19.6644ZM19.6644 9.58512L19.6644 18.978L23.0644 18.978L23.0644 9.58512L19.6644 9.58512ZM3.67617 24.4195L19.1712 5.7528L16.5551 3.58118L1.06005 22.2479L3.67617 24.4195ZM2.36811 21.6337H2.1665V25.0337H2.36811V21.6337ZM2.1665 21.6337C2.55311 21.6337 2.8665 21.9471 2.8665 22.3337H-0.533496C-0.533496 23.8248 0.675329 25.0337 2.1665 25.0337V21.6337ZM2.8665 22.3337V5.66699H-0.533496V22.3337H2.8665ZM2.8665 5.66699C2.8665 6.05359 2.5531 6.36699 2.1665 6.36699V2.96699C0.675339 2.96699 -0.533496 4.17582 -0.533496 5.66699H2.8665ZM2.1665 6.36699H17.8631V2.96699H2.1665V6.36699ZM9.9165 9.65015H5.83317V13.0501H9.9165V9.65015ZM8.2165 9.65015V11.3501H11.6165V9.65015H8.2165ZM5.83317 11.3501H9.9165V7.95015H5.83317V11.3501ZM7.53317 11.3501V9.65015H4.13317V11.3501H7.53317Z" fill="white" style="fill:white;fill:white;fill-opacity:1;" mask="url(#path-1-inside-1_287_9)"/>
<path d="M4.56348 25.2686L22.1405 4.08389" stroke="white" style="stroke:white;stroke:white;stroke-opacity:1;" stroke-width="2" stroke-linecap="square" stroke-linejoin="round"/>
</svg>`,
  minimize: String.raw`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="0.769231" y="0.769231" width="18.4615" height="18.4615" rx="0.769231" stroke="white" stroke-width="1.53846"/>
<path d="M11.5385 12.3077C11.5385 11.8829 11.8829 11.5385 12.3077 11.5385H19.2308V18.4615C19.2308 18.8864 18.8864 19.2308 18.4616 19.2308H11.5385V12.3077Z" stroke="white" stroke-width="1.53846"/>
<path d="M0.769287 0.769226L8.9723 8.92412" stroke="white" stroke-width="1.53846"/>
<path d="M9.4967 4.71716V9.4486H4.74146" stroke="white" stroke-width="1.53846" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`
};

// src/index.js
var root = document.getElementById("app");
var LOCAL_VIDEO_ID = "desktop-call-local-video";
var REMOTE_VIDEO_ID = "desktop-call-remote-video";
var DEVICE_TYPE = {
  camera: "camera",
  microphone: "microphone",
  speaker: "speaker"
};
var CALL_MEDIA = {
  audio: "audio",
  video: "video"
};
var CALL_PHASE = {
  idle: "idle",
  incoming: "incoming",
  outgoing: "outgoing",
  connected: "connected",
  ending: "ending",
  error: "error"
};
var SIZE_MODE = {
  regular: "regular",
  compact: "compact"
};
var HOST_PERMISSION_REQUEST_TIMEOUT_MS = 8e3;
var TICK_INTERVAL_MS = 1e3;
var CALL_ENGINE_READY_TIMEOUT_MS = 15e3;
var CALLER_PROFILE_LOOKUP_TIMEOUT_MS = 1200;
var DEVICE_POPOVER_CLOSE_DELAY_MS = 160;
var DEVICE_POPOVER_EDGE_MARGIN_PX = 12;
var DEVICE_POPOVER_TRIGGER_GAP_PX = 16;
var DEVICE_POPOVER_BRIDGE_MIN_HEIGHT_PX = 18;
var DEVICE_POPOVER_BRIDGE_OVERLAP_PX = 10;
var COMPACT_LAYOUT_MAX_WIDTH_PX = 200;
var AUTOPLAY_RESUME_HINT_TEXT = "\u97F3\u9891\u64AD\u653E\u53D7\u9650\uFF0C\u70B9\u51FB\u7A97\u53E3\u6062\u590D\u58F0\u97F3";
var IOS_OFFLINE_PUSH_TYPE_VOIP = 1;
var nextHostPermissionRequestId = 1;
var pendingHostPermissionRequests = /* @__PURE__ */ new Map();
var callerProfileCache = /* @__PURE__ */ new Map();
var devicePopoverCloseTimer = null;
var embeddedVideoPresentationObserver = null;
var guardedEmbeddedVideoElements = /* @__PURE__ */ new WeakSet();
var state = {
  engine: null,
  engineListeners: [],
  trtcCloudListeners: [],
  initialized: false,
  bootstrapSignature: "",
  bootstrapPayload: null,
  phase: CALL_PHASE.idle,
  connectionRole: "",
  activeRoomId: "",
  activeCallId: "",
  activeMediaType: CALL_MEDIA.audio,
  activeReason: "",
  activeMessage: "",
  lastUserData: {},
  caller: {
    id: "",
    name: "",
    avatar: ""
  },
  peer: {
    id: "",
    name: "",
    avatar: ""
  },
  remoteUserId: "",
  remoteVideoAttachedUserId: "",
  remoteVideoAvailable: false,
  remoteAudioAvailable: false,
  remoteVideoObserved: false,
  remoteAudioObserved: false,
  audioEnabled: false,
  videoEnabled: false,
  speakerEnabled: true,
  preferredAudioEnabled: true,
  preferredVideoEnabled: true,
  cameraPermissionDenied: false,
  microphonePermissionDenied: false,
  sessionNotice: "",
  autoplayResumeHint: "",
  devices: {
    cameraList: [],
    microphoneList: [],
    speakerList: [],
    currentCamera: "",
    currentMicrophone: "",
    currentSpeaker: ""
  },
  activeDevicePopover: "",
  callStartedAt: 0,
  callConnectedAt: 0,
  elapsedLabel: "00:00",
  tickTimer: null,
  terminalBridgeKey: "",
  beginBridgeKey: "",
  lastStatusText: "\u6B63\u5728\u521D\u59CB\u5316\u684C\u9762\u901A\u8BDD...",
  lastFlutterStateSignature: "",
  networkHint: "",
  sizeMode: SIZE_MODE.regular,
  pendingLocalTerminalAction: ""
};
var refs = {};
function trimDiagText(value, maxLength = 240) {
  const text = safeString(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}
function summarizeDiagPayload(payload = {}) {
  if (!payload || typeof payload !== "object") {
    return {
      value: trimDiagText(payload),
      phase: state.phase,
      connectionRole: state.connectionRole
    };
  }
  const userData = parseUserData(payload.userData);
  return {
    keys: Object.keys(payload).sort(),
    roomId: resolveRoomId(payload),
    callId: safeString(payload.callId),
    mediaType: resolveMediaType(payload.callMediaType ?? payload.mediaType),
    rawMediaType: safeString(payload.callMediaType ?? payload.mediaType),
    userId: safeString(payload.userID ?? payload.userId),
    callerId: safeString(payload.callerId ?? payload.inviter ?? payload.sponsor),
    invitedUserIds: Array.isArray(payload.userIDList) ? payload.userIDList.map((item) => safeString(item)).filter(Boolean).slice(0, 5) : [],
    userDataKeys: userData && typeof userData === "object" ? Object.keys(userData).sort() : [],
    message: trimDiagText(payload.message ?? payload.errMsg),
    code: safeString(payload.code ?? payload.errorCode),
    phase: state.phase,
    connectionRole: state.connectionRole,
    activeRoomId: state.activeRoomId,
    activeCallId: state.activeCallId
  };
}
function diagLog(label, payload = {}) {
  try {
    console.log(`[DesktopCallDiag] ${label} ${safeJsonStringify(payload)}`);
    try {
      postToWebHostBridge({
        type: "diag",
        label,
        detail: payload
      });
    } catch (_) {
    }
  } catch (error) {
    console.log(
      `[DesktopCallDiag] ${label} ${safeJsonStringify({
        diagSerializeError: trimDiagText(error?.message || error)
      })}`
    );
  }
}
function resolveCallEngineExport() {
  const candidates = [
    {
      source: "named_export",
      value: import_call_engine_lite_js.TUICallEngine
    },
    {
      source: "default_module_named",
      value: import_call_engine_lite_js.default?.TUICallEngine
    },
    {
      source: "default_module_default",
      value: import_call_engine_lite_js.default?.default
    },
    {
      source: "default_module",
      value: import_call_engine_lite_js.default
    }
  ];
  for (const candidate of candidates) {
    if (candidate.value && typeof candidate.value.createInstance === "function") {
      return candidate;
    }
  }
  const exportShape = candidates.map((candidate) => ({
    source: candidate.source,
    type: typeof candidate.value,
    hasCreateInstance: Boolean(
      candidate.value && typeof candidate.value.createInstance === "function"
    ),
    keys: candidate.value && typeof candidate.value === "object" ? Object.keys(candidate.value).sort().slice(0, 20) : []
  }));
  throw new Error(
    `call-engine-lite-js export shape unsupported: ${safeJsonStringify(exportShape)}`
  );
}
async function waitForCallEngineReady(callEngineExport) {
  const engineExport = callEngineExport?.value;
  if (!engineExport) {
    return;
  }
  if (engineExport.isWasmReady === true) {
    diagLog("bootstrap_engine_ready_already", {
      source: callEngineExport.source
    });
    return;
  }
  if (typeof engineExport.once !== "function") {
    diagLog("bootstrap_engine_ready_skip_no_once", {
      source: callEngineExport.source,
      isWasmReady: engineExport.isWasmReady === true
    });
    return;
  }
  diagLog("bootstrap_engine_ready_wait_start", {
    source: callEngineExport.source,
    isWasmReady: engineExport.isWasmReady === true
  });
  await new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(
        new Error(`call-engine-lite-js ready timeout after ${CALL_ENGINE_READY_TIMEOUT_MS}ms`)
      );
    }, CALL_ENGINE_READY_TIMEOUT_MS);
    engineExport.once("ready", () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      diagLog("bootstrap_engine_ready_event", {
        source: callEngineExport.source
      });
      resolve();
    });
  });
}
function safeString(value) {
  if (value === void 0 || value === null) {
    return "";
  }
  return String(value).trim();
}
function safeNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}
function isWindowsFlutterWebViewHost() {
  return Boolean(window.chrome?.webview?.postMessage);
}
function patchReadOnlyProperty(target, key, value, results, label) {
  if (!target) {
    results[label] = "missing_target";
    return;
  }
  try {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      get() {
        return value;
      },
      set(_) {
      }
    });
    results[label] = "patched";
  } catch (error) {
    results[label] = trimDiagText(error?.message || error);
  }
}
function applyEmbeddedVideoPlaybackAttributes(node, reason = "") {
  if (!(node instanceof HTMLVideoElement) || guardedEmbeddedVideoElements.has(node)) {
    return;
  }
  guardedEmbeddedVideoElements.add(node);
  try {
    node.controls = false;
  } catch (_) {
  }
  try {
    node.removeAttribute("controls");
  } catch (_) {
  }
  try {
    node.disablePictureInPicture = true;
  } catch (_) {
  }
  try {
    node.disableRemotePlayback = true;
  } catch (_) {
  }
  try {
    node.playsInline = true;
  } catch (_) {
  }
  try {
    node.setAttribute("playsinline", "");
    node.setAttribute("webkit-playsinline", "");
    node.setAttribute("x5-playsinline", "");
  } catch (_) {
  }
  try {
    node.removeAttribute("autopictureinpicture");
  } catch (_) {
  }
  try {
    node.controlsList?.add?.("nofullscreen");
    node.controlsList?.add?.("noplaybackrate");
    node.controlsList?.add?.("nodownload");
    node.controlsList?.add?.("noremoteplayback");
  } catch (_) {
  }
  try {
    node.style.pointerEvents = "none";
    node.style.userSelect = "none";
    node.style.webkitUserSelect = "none";
  } catch (_) {
  }
  diagLog("embedded_video_presentation_guard_applied", {
    reason,
    tagName: safeString(node.tagName),
    disablePictureInPicture: "disablePictureInPicture" in node ? node.disablePictureInPicture === true : null,
    disableRemotePlayback: "disableRemotePlayback" in node ? node.disableRemotePlayback === true : null,
    controls: node.controls === true
  });
}
function guardEmbeddedVideoPlaybackTree(node, reason = "") {
  if (!node) {
    return;
  }
  if (node instanceof HTMLVideoElement) {
    applyEmbeddedVideoPlaybackAttributes(node, reason);
    return;
  }
  if (typeof node.querySelectorAll !== "function") {
    return;
  }
  node.querySelectorAll("video").forEach((video) => {
    applyEmbeddedVideoPlaybackAttributes(video, reason);
  });
}
function installEmbeddedMediaPresentationGuard() {
  if (!isWindowsFlutterWebViewHost()) {
    return;
  }
  if (window.__JOTMO_DESKTOP_CALL_PRESENTATION_GUARD_INSTALLED__ === true) {
    return;
  }
  window.__JOTMO_DESKTOP_CALL_PRESENTATION_GUARD_INSTALLED__ = true;
  const patchResults = {};
  patchReadOnlyProperty(
    document,
    "pictureInPictureEnabled",
    false,
    patchResults,
    "document.pictureInPictureEnabled"
  );
  patchReadOnlyProperty(
    Document.prototype,
    "pictureInPictureEnabled",
    false,
    patchResults,
    "Document.prototype.pictureInPictureEnabled"
  );
  patchReadOnlyProperty(
    document,
    "fullscreenEnabled",
    false,
    patchResults,
    "document.fullscreenEnabled"
  );
  patchReadOnlyProperty(
    Document.prototype,
    "fullscreenEnabled",
    false,
    patchResults,
    "Document.prototype.fullscreenEnabled"
  );
  patchReadOnlyProperty(
    Element.prototype,
    "requestFullscreen",
    void 0,
    patchResults,
    "Element.prototype.requestFullscreen"
  );
  patchReadOnlyProperty(
    Element.prototype,
    "webkitRequestFullscreen",
    void 0,
    patchResults,
    "Element.prototype.webkitRequestFullscreen"
  );
  patchReadOnlyProperty(
    Element.prototype,
    "msRequestFullscreen",
    void 0,
    patchResults,
    "Element.prototype.msRequestFullscreen"
  );
  patchReadOnlyProperty(
    Element.prototype,
    "mozRequestFullScreen",
    void 0,
    patchResults,
    "Element.prototype.mozRequestFullScreen"
  );
  patchReadOnlyProperty(
    HTMLVideoElement.prototype,
    "requestPictureInPicture",
    void 0,
    patchResults,
    "HTMLVideoElement.prototype.requestPictureInPicture"
  );
  patchReadOnlyProperty(
    HTMLVideoElement.prototype,
    "webkitSetPresentationMode",
    void 0,
    patchResults,
    "HTMLVideoElement.prototype.webkitSetPresentationMode"
  );
  patchReadOnlyProperty(
    HTMLVideoElement.prototype,
    "webkitSupportsPresentationMode",
    false,
    patchResults,
    "HTMLVideoElement.prototype.webkitSupportsPresentationMode"
  );
  const exitInlinePresentationModes = async (label) => {
    const activeFullscreenElement = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
    if (activeFullscreenElement) {
      diagLog("embedded_presentation_force_exit_fullscreen", {
        label,
        tagName: safeString(activeFullscreenElement.tagName)
      });
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          await document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
          await document.msExitFullscreen();
        }
      } catch (error) {
        diagLog("embedded_presentation_force_exit_fullscreen_failed", {
          label,
          error: trimDiagText(error?.message || error)
        });
      }
    }
    if (document.pictureInPictureElement && document.exitPictureInPicture) {
      diagLog("embedded_presentation_force_exit_pip", {
        label,
        tagName: safeString(document.pictureInPictureElement?.tagName)
      });
      try {
        await document.exitPictureInPicture();
      } catch (error) {
        diagLog("embedded_presentation_force_exit_pip_failed", {
          label,
          error: trimDiagText(error?.message || error)
        });
      }
    }
  };
  document.addEventListener(
    "fullscreenchange",
    () => {
      void exitInlinePresentationModes("fullscreenchange");
    },
    true
  );
  document.addEventListener(
    "enterpictureinpicture",
    () => {
      void exitInlinePresentationModes("enterpictureinpicture");
    },
    true
  );
  document.addEventListener(
    "webkitbeginfullscreen",
    () => {
      void exitInlinePresentationModes("webkitbeginfullscreen");
    },
    true
  );
  if (!embeddedVideoPresentationObserver) {
    embeddedVideoPresentationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          guardEmbeddedVideoPlaybackTree(node, "mutation");
        });
      });
    });
    embeddedVideoPresentationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
  guardEmbeddedVideoPlaybackTree(document, "init");
  diagLog("embedded_media_presentation_guard_installed", patchResults);
}
function captureRuntimeSnapshot(extra = {}) {
  const localVideo = refs.localVideo;
  const remoteVideo = refs.remoteVideo;
  const userActivation = window.navigator?.userActivation;
  return {
    phase: state.phase,
    connectionRole: state.connectionRole,
    activeRoomId: state.activeRoomId,
    activeCallId: state.activeCallId,
    activeMediaType: state.activeMediaType,
    audioEnabled: state.audioEnabled,
    videoEnabled: state.videoEnabled,
    preferredAudioEnabled: state.preferredAudioEnabled,
    preferredVideoEnabled: state.preferredVideoEnabled,
    speakerEnabled: state.speakerEnabled,
    remoteAudioAvailable: state.remoteAudioAvailable,
    remoteVideoAvailable: state.remoteVideoAvailable,
    visibilityState: safeString(document.visibilityState),
    hidden: document.hidden === true,
    hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() === true : null,
    activeElement: safeString(document.activeElement?.tagName),
    userActivationActive: userActivation?.isActive === true,
    userActivationHasBeenActive: userActivation?.hasBeenActive === true,
    localVideoReadyState: safeNumber(localVideo?.readyState),
    localVideoPaused: localVideo?.paused === true,
    localVideoHasStream: Boolean(localVideo?.srcObject),
    remoteVideoReadyState: safeNumber(remoteVideo?.readyState),
    remoteVideoPaused: remoteVideo?.paused === true,
    remoteVideoHasStream: Boolean(remoteVideo?.srcObject),
    ...extra
  };
}
function parseUserData(raw) {
  if (!raw) {
    return {};
  }
  if (typeof raw === "object") {
    return raw;
  }
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return {};
  }
}
function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}
function resolveIncomingCallerId(eventPayload = {}) {
  return safeString(eventPayload.callerId ?? eventPayload.inviter ?? eventPayload.sponsor);
}
function buildIncomingCallerFallback(eventPayload = {}) {
  const userData = parseUserData(eventPayload.userData);
  const callerId = resolveIncomingCallerId(eventPayload);
  return {
    id: callerId,
    name: safeString(userData.callerName) || safeString(userData.callerNickname) || callerId,
    avatar: safeString(userData.callerAvatar),
    userData
  };
}
function normalizeTimUserProfileList(response) {
  const candidates = [
    response?.data,
    response?.data?.profileUserInfoList,
    response?.data?.userProfileList,
    response?.profileUserInfoList,
    response?.userProfileList
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  if (response?.data && typeof response.data === "object") {
    return [response.data];
  }
  return [];
}
function extractTimUserProfile(response, callerId) {
  const profileList = normalizeTimUserProfileList(response);
  const matchedProfile = profileList.find(
    (profile) => safeString(profile?.userID ?? profile?.userId) === callerId
  ) || profileList[0];
  if (!matchedProfile || typeof matchedProfile !== "object") {
    return {
      id: callerId,
      name: "",
      avatar: ""
    };
  }
  return {
    id: safeString(matchedProfile.userID ?? matchedProfile.userId ?? callerId),
    name: safeString(matchedProfile.nick ?? matchedProfile.nickName ?? matchedProfile.name),
    avatar: safeString(matchedProfile.avatar ?? matchedProfile.faceUrl ?? matchedProfile.headimg)
  };
}
async function fetchIncomingCallerProfileFromTim(callerId) {
  if (!callerId) {
    return null;
  }
  const cachedProfile = callerProfileCache.get(callerId);
  if (cachedProfile) {
    return cachedProfile;
  }
  if (!state.engine || typeof state.engine.getTim !== "function") {
    return null;
  }
  let tim = null;
  try {
    tim = state.engine.getTim();
  } catch (error) {
    diagLog("incoming_caller_profile_tim_unavailable", {
      callerId,
      error: trimDiagText(error?.message || error)
    });
    return null;
  }
  if (!tim || typeof tim.getUserProfile !== "function") {
    return null;
  }
  try {
    const response = await withTimeout(
      tim.getUserProfile({
        userIDList: [callerId]
      }),
      CALLER_PROFILE_LOOKUP_TIMEOUT_MS,
      `getUserProfile timeout after ${CALLER_PROFILE_LOOKUP_TIMEOUT_MS}ms`
    );
    const profile = extractTimUserProfile(response, callerId);
    if (!profile.name && !profile.avatar) {
      return null;
    }
    callerProfileCache.set(callerId, profile);
    diagLog("incoming_caller_profile_resolved", {
      callerId,
      hasName: Boolean(profile.name),
      hasAvatar: Boolean(profile.avatar),
      source: "tim"
    });
    return profile;
  } catch (error) {
    diagLog("incoming_caller_profile_lookup_failed", {
      callerId,
      error: trimDiagText(error?.message || error)
    });
    return null;
  }
}
async function resolveIncomingCallerProfile(eventPayload = {}) {
  const fallbackProfile = buildIncomingCallerFallback(eventPayload);
  const timProfile = await fetchIncomingCallerProfileFromTim(fallbackProfile.id);
  if (!timProfile) {
    diagLog("incoming_caller_profile_fallback", {
      callerId: fallbackProfile.id,
      hasUserDataName: Boolean(fallbackProfile.name),
      hasUserDataAvatar: Boolean(fallbackProfile.avatar)
    });
    return fallbackProfile;
  }
  return {
    id: fallbackProfile.id,
    name: timProfile.name || fallbackProfile.name || fallbackProfile.id,
    avatar: timProfile.avatar || fallbackProfile.avatar,
    userData: fallbackProfile.userData
  };
}
function parseHostEnvelope(raw) {
  if (!raw) {
    return null;
  }
  if (typeof raw === "object") {
    return raw;
  }
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return null;
  }
}
function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return "{}";
  }
}
function resolveWebHostCallRequestId() {
  try {
    const parsed = JSON.parse(String(window.name || "{}"));
    return safeString(parsed?.callRequestId);
  } catch (_) {
    return "";
  }
}
function postToWebHostBridge(message) {
  if (!window.parent || window.parent === window) {
    return false;
  }
  const callRequestId = resolveWebHostCallRequestId();
  if (!callRequestId) {
    return false;
  }
  const payload = typeof message === "string" ? message : safeJsonStringify(message);
  window.parent.postMessage({
    channel: "jotmo-desktop-call",
    callRequestId,
    message: payload
  }, window.location.origin);
  return true;
}
function escapeHtml(value) {
  return safeString(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1e3));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function resolveMediaType(value) {
  const raw = safeString(value).toLowerCase();
  if (raw === "2" || raw === "video" || raw === "videocall" || raw === "video_call") {
    return CALL_MEDIA.video;
  }
  return CALL_MEDIA.audio;
}
function toCallType(mediaType) {
  return mediaType === CALL_MEDIA.video ? import_call_engine_lite_js.TUICallType.VIDEO_CALL : import_call_engine_lite_js.TUICallType.AUDIO_CALL;
}
function buildOfflinePushInfo(payload = {}, mediaType = CALL_MEDIA.audio) {
  const rawInfo = payload.offlinePushInfo && typeof payload.offlinePushInfo === "object" ? payload.offlinePushInfo : {};
  const callTypeText = mediaType === CALL_MEDIA.video ? "\u89C6\u9891\u901A\u8BDD" : "\u8BED\u97F3\u901A\u8BDD";
  const title = safeString(rawInfo.title) || safeString(payload.callerName) || callTypeText;
  const description = safeString(rawInfo.description ?? rawInfo.desc) || `\u9080\u8BF7\u4F60\u8FDB\u884C${callTypeText}`;
  const extension = safeString(rawInfo.extension ?? rawInfo.ext) || safeString(payload.userData);
  const rawIOSPushType = Number(rawInfo.iOSPushType);
  return {
    isDisablePush: rawInfo.isDisablePush === true,
    title,
    description,
    extension,
    ignoreIOSBadge: rawInfo.ignoreIOSBadge !== false,
    iOSPushType: Number.isFinite(rawIOSPushType) ? rawIOSPushType : IOS_OFFLINE_PUSH_TYPE_VOIP
  };
}
function resolveRoomId(payload = {}) {
  return safeString(payload.strRoomID) || safeString(payload.strRoomId) || safeString(payload.roomId) || safeString(payload.roomID);
}
function resolveCallSessionKey(payload = {}) {
  return safeString(payload.callId) || resolveRoomId(payload) || state.activeCallId || state.activeRoomId || state.connectionRole || "call-session";
}
function isExpectedSessionStale(expectedSessionKey = "") {
  if (!expectedSessionKey) {
    return false;
  }
  if (!getFlutterHasActiveCall()) {
    return true;
  }
  const currentSessionKey = resolveCallSessionKey();
  return Boolean(currentSessionKey && currentSessionKey !== expectedSessionKey);
}
function buildExpectedSessionSnapshot(reason, expectedSessionKey = "") {
  return captureRuntimeSnapshot({
    reason,
    expectedSessionKey,
    currentSessionKey: resolveCallSessionKey(),
    flutterHasActiveCall: getFlutterHasActiveCall()
  });
}
function resolveFlutterBridge() {
  if (window.chrome?.webview?.postMessage) {
    return {
      postMessage(message) {
        window.chrome.webview.postMessage(message);
      }
    };
  }
  if (typeof JotmoDesktopCallBridge !== "undefined" && JotmoDesktopCallBridge && typeof JotmoDesktopCallBridge.postMessage === "function") {
    return JotmoDesktopCallBridge;
  }
  if (window.JotmoDesktopCallBridge?.postMessage) {
    return window.JotmoDesktopCallBridge;
  }
  if (window.webkit?.messageHandlers?.JotmoDesktopCallBridge?.postMessage) {
    return {
      postMessage(message) {
        window.webkit.messageHandlers.JotmoDesktopCallBridge.postMessage(message);
      }
    };
  }
  return null;
}
function postToFlutter(type, extra = {}) {
  const peer = getFlutterPeer();
  const statePayload = buildFlutterStatePayload(extra);
  const payload = safeJsonStringify({
    type,
    ...imBridgePayload(type, extra),
    roomId: statePayload.roomId,
    callId: statePayload.callId,
    mediaType: statePayload.mediaType,
    statusText: statePayload.statusText,
    phase: statePayload.phase,
    hasActiveCall: statePayload.hasActiveCall,
    audioEnabled: statePayload.audioEnabled,
    videoEnabled: statePayload.videoEnabled,
    speakerEnabled: statePayload.speakerEnabled,
    elapsedLabel: statePayload.elapsedLabel,
    caller: {
      name: safeString(extra.callerName ?? state.caller.name),
      avatar: safeString(extra.callerAvatar ?? state.caller.avatar)
    },
    peer: {
      name: safeString(extra.peerName ?? peer.name),
      avatar: safeString(extra.peerAvatar ?? peer.avatar)
    },
    userData: extra.userData && typeof extra.userData === "object" ? extra.userData : state.lastUserData,
    reason: safeString(extra.reason),
    message: safeString(extra.message)
  });
  const bridge = resolveFlutterBridge();
  const postedToWebHost = postToWebHostBridge(payload);
  diagLog("post_to_flutter", {
    type,
    hasBridge: Boolean(bridge),
    postedToWebHost,
    roomId: statePayload.roomId,
    callId: statePayload.callId,
    mediaType: statePayload.mediaType,
    reason: safeString(extra.reason),
    message: trimDiagText(extra.message),
    phase: state.phase,
    connectionRole: state.connectionRole
  });
  if (!bridge) {
    if (postedToWebHost) {
      return true;
    }
    console.warn("[DesktopCall] flutter bridge unavailable", payload);
    return false;
  }
  bridge.postMessage(payload);
  return true;
}
function postLocalTerminalToWebHost(type, message) {
  const peer = getFlutterPeer();
  const payload = safeJsonStringify({
    type,
    roomId: state.activeRoomId,
    callId: state.activeCallId,
    mediaType: state.activeMediaType,
    statusText: safeString(message),
    phase: CALL_PHASE.ending,
    hasActiveCall: false,
    audioEnabled: state.audioEnabled,
    videoEnabled: state.videoEnabled,
    speakerEnabled: state.speakerEnabled,
    elapsedLabel: state.elapsedLabel,
    caller: {
      name: state.caller.name,
      avatar: state.caller.avatar
    },
    peer: {
      name: peer.name,
      avatar: peer.avatar
    },
    userData: state.lastUserData,
    reason: "local_hangup_hint",
    message: safeString(message)
  });
  const posted = postToWebHostBridge(payload);
  if (!posted && window.arkmeCallTransport) window.arkmeCallTransport.emit(payload);
  diagLog("local_terminal_web_host_hint", {
    type,
    posted,
    roomId: state.activeRoomId,
    callId: state.activeCallId,
    mediaType: state.activeMediaType,
    phase: state.phase
  });
  return posted;
}
function setStatusText(text) {
  state.lastStatusText = safeString(text);
}
function setSessionNotice(text) {
  state.sessionNotice = safeString(text);
}
function clearSessionNotice() {
  state.sessionNotice = "";
}
function setAutoplayResumeHint(text = AUTOPLAY_RESUME_HINT_TEXT) {
  const nextText = safeString(text) || AUTOPLAY_RESUME_HINT_TEXT;
  if (state.autoplayResumeHint === nextText) {
    return;
  }
  state.autoplayResumeHint = nextText;
  diagLog("autoplay_resume_hint_set", {
    message: nextText,
    phase: state.phase,
    connectionRole: state.connectionRole
  });
  render();
}
function clearAutoplayResumeHint(reason = "") {
  if (!state.autoplayResumeHint) {
    return;
  }
  diagLog("autoplay_resume_hint_cleared", {
    reason: safeString(reason),
    phase: state.phase,
    connectionRole: state.connectionRole
  });
  state.autoplayResumeHint = "";
  render();
}
function getFlutterPeer() {
  if (safeString(state.peer.name) || safeString(state.peer.avatar)) {
    return state.peer;
  }
  if (safeString(state.caller.name) || safeString(state.caller.avatar)) {
    return state.caller;
  }
  return {
    name: "",
    avatar: ""
  };
}
function getFlutterAudioEnabled() {
  if (state.phase === CALL_PHASE.incoming) {
    return state.preferredAudioEnabled;
  }
  return state.audioEnabled;
}
function getFlutterVideoEnabled() {
  if (state.activeMediaType !== CALL_MEDIA.video) {
    return false;
  }
  if (state.phase === CALL_PHASE.incoming) {
    return state.preferredVideoEnabled || state.videoEnabled;
  }
  return state.videoEnabled;
}
function getFlutterHasActiveCall() {
  return state.phase === CALL_PHASE.incoming || state.phase === CALL_PHASE.outgoing || state.phase === CALL_PHASE.connected;
}
function buildFlutterStatePayload(extra = {}) {
  const peer = getFlutterPeer();
  return {
    roomId: safeString(extra.roomId ?? state.activeRoomId),
    callId: safeString(extra.callId ?? state.activeCallId),
    mediaType: resolveMediaType(extra.mediaType ?? state.activeMediaType),
    statusText: safeString(extra.statusText ?? state.lastStatusText),
    phase: safeString(extra.phase ?? state.phase),
    hasActiveCall: extra.hasActiveCall ?? getFlutterHasActiveCall(),
    audioEnabled: extra.audioEnabled ?? getFlutterAudioEnabled(),
    videoEnabled: extra.videoEnabled ?? getFlutterVideoEnabled(),
    speakerEnabled: extra.speakerEnabled ?? state.speakerEnabled,
    elapsedLabel: safeString(extra.elapsedLabel ?? state.elapsedLabel),
    peerName: safeString(extra.peerName ?? peer.name),
    peerAvatar: safeString(extra.peerAvatar ?? peer.avatar)
  };
}
function emitStateSnapshot(reason = "render", { force = false } = {}) {
  const payload = buildFlutterStatePayload();
  const signature = safeJsonStringify(payload);
  if (!force && signature === state.lastFlutterStateSignature) {
    return;
  }
  state.lastFlutterStateSignature = signature;
  postToFlutter("state", {
    ...payload,
    reason
  });
}
function buildInitials(name) {
  const trimmed = safeString(name);
  if (!trimmed) {
    return "J";
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}
function isMacFlutterWebViewHost() {
  return !window.chrome?.webview?.postMessage && Boolean(resolveFlutterBridge());
}
function buildHostPermissionRequestId() {
  return `host-media-${Date.now()}-${nextHostPermissionRequestId++}`;
}
function normalizeHostPermissionResult(payload = {}) {
  return {
    requestId: safeString(payload.requestId),
    cameraRequested: payload.cameraRequested === true || payload.camera === true,
    microphoneRequested: payload.microphoneRequested === true || payload.microphone === true,
    cameraGranted: payload.cameraGranted === true,
    microphoneGranted: payload.microphoneGranted === true,
    cameraStatus: safeString(payload.cameraStatus),
    microphoneStatus: safeString(payload.microphoneStatus),
    granted: payload.granted === true,
    message: safeString(payload.message)
  };
}
function settleHostPermissionRequest(requestId, payload, isError = false) {
  const pending = pendingHostPermissionRequests.get(requestId);
  if (!pending) {
    diagLog("permission_request_settle_missing", {
      requestId,
      isError,
      payload: summarizeDiagPayload(payload)
    });
    return;
  }
  pendingHostPermissionRequests.delete(requestId);
  window.clearTimeout(pending.timeoutId);
  diagLog("permission_request_settle", {
    requestId,
    isError,
    payload: summarizeDiagPayload(payload)
  });
  if (isError) {
    pending.reject(payload);
    return;
  }
  pending.resolve(payload);
}
async function requestHostMediaPermissions({
  camera = false,
  microphone = false,
  reason = ""
} = {}) {
  if (!camera && !microphone || !isMacFlutterWebViewHost()) {
    return {
      requestId: "",
      cameraRequested: Boolean(camera),
      microphoneRequested: Boolean(microphone),
      cameraGranted: true,
      microphoneGranted: true,
      cameraStatus: "",
      microphoneStatus: "",
      granted: true,
      message: ""
    };
  }
  const bridge = resolveFlutterBridge();
  if (!bridge) {
    return {
      requestId: "",
      cameraRequested: Boolean(camera),
      microphoneRequested: Boolean(microphone),
      cameraGranted: true,
      microphoneGranted: true,
      cameraStatus: "",
      microphoneStatus: "",
      granted: true,
      message: ""
    };
  }
  const requestId = buildHostPermissionRequestId();
  diagLog("permission_request_start", {
    requestId,
    camera,
    microphone,
    reason,
    hasBridge: Boolean(bridge)
  });
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pendingHostPermissionRequests.delete(requestId);
      diagLog("permission_request_timeout", {
        requestId,
        camera,
        microphone,
        reason
      });
      reject(new Error(`host media permission timeout after ${HOST_PERMISSION_REQUEST_TIMEOUT_MS}ms`));
    }, HOST_PERMISSION_REQUEST_TIMEOUT_MS);
    pendingHostPermissionRequests.set(requestId, {
      resolve,
      reject,
      timeoutId
    });
    try {
      bridge.postMessage(
        safeJsonStringify({
          type: "media_permission_request",
          requestId,
          camera,
          microphone,
          reason
        })
      );
      diagLog("permission_request_sent", {
        requestId,
        camera,
        microphone,
        reason
      });
    } catch (error) {
      settleHostPermissionRequest(requestId, error, true);
    }
  });
}
function isPermissionError(error) {
  const message = safeString(error?.message || error).toLowerCase();
  return message.includes("permission") || message.includes("microphone") || message.includes("camera") || message.includes("authorized") || message.includes("notallowederror") || message.includes("\u6743\u9650") || message.includes("\u6388\u6743") || message.includes("\u9EA6\u514B\u98CE") || message.includes("\u6444\u50CF\u5934") || message.includes("\u76F8\u673A");
}
function normalizeErrorMessage(error, fallback) {
  const message = safeString(error?.message || error);
  return message || fallback;
}
function emitPermissionDenied(error, fallbackMessage) {
  const message = normalizeErrorMessage(error, fallbackMessage || "\u7F3A\u5C11\u9EA6\u514B\u98CE\u6216\u76F8\u673A\u6743\u9650");
  diagLog("emit_permission_denied", {
    message,
    phase: state.phase,
    connectionRole: state.connectionRole
  });
  setStatusText(message);
  state.autoplayResumeHint = "";
  state.phase = CALL_PHASE.error;
  render();
  postToFlutter("permission_denied", {
    mediaType: state.activeMediaType,
    message
  });
}
function emitFatalError(error, fallbackMessage, options = {}) {
  const renderErrorUi = options.renderErrorUi !== false;
  const preserveBootstrap = options.preserveBootstrap === true;
  const message = normalizeErrorMessage(error, fallbackMessage || "\u684C\u9762\u901A\u8BDD\u521D\u59CB\u5316\u5931\u8D25");
  diagLog("emit_fatal_error", {
    message,
    renderErrorUi,
    preserveBootstrap,
    phase: state.phase,
    connectionRole: state.connectionRole
  });
  setStatusText(message);
  state.autoplayResumeHint = "";
  state.phase = CALL_PHASE.error;
  if (renderErrorUi) {
    render();
  }
  postToFlutter("fatal_error", {
    mediaType: state.activeMediaType,
    message
  });
  if (!renderErrorUi) {
    resetRuntimeState({ preserveBootstrap });
  }
}
function clearTickTimer() {
  if (state.tickTimer) {
    window.clearInterval(state.tickTimer);
    state.tickTimer = null;
  }
}
function updateElapsedLabel() {
  const startAt = state.callConnectedAt || state.callStartedAt;
  state.elapsedLabel = startAt ? formatDuration(Date.now() - startAt) : "00:00";
}
function ensureTickTimer() {
  clearTickTimer();
  updateElapsedLabel();
  if (!state.callStartedAt && !state.callConnectedAt) {
    return;
  }
  state.tickTimer = window.setInterval(() => {
    updateElapsedLabel();
    renderTimerOnly();
    emitStateSnapshot("tick");
  }, TICK_INTERVAL_MS);
}
function stopTickTimer() {
  clearTickTimer();
  state.elapsedLabel = "00:00";
}
function getDisplayPeer() {
  if (state.phase === CALL_PHASE.incoming) {
    return {
      name: state.caller.name || state.caller.id || "Jotmo \u7528\u6237",
      avatar: state.caller.avatar,
      id: state.caller.id
    };
  }
  return {
    name: state.peer.name || state.peer.id || "\u5BF9\u65B9",
    avatar: state.peer.avatar,
    id: state.peer.id
  };
}
function getStatusHeadline() {
  const mediaText = state.activeMediaType === CALL_MEDIA.video ? "\u89C6\u9891\u901A\u8BDD" : "\u8BED\u97F3\u901A\u8BDD";
  switch (state.phase) {
    case CALL_PHASE.idle:
      return state.initialized ? "" : "\u6B63\u5728\u8FDE\u63A5\u901A\u8BDD\u670D\u52A1";
    case CALL_PHASE.incoming:
      return `\u9080\u8BF7\u4F60\u8FDB\u884C${mediaText}`;
    case CALL_PHASE.outgoing:
      return "\u6B63\u5728\u7B49\u5F85\u5BF9\u65B9\u63A5\u542C";
    case CALL_PHASE.connected:
      return `${mediaText}\u4E2D`;
    case CALL_PHASE.ending:
      return state.lastStatusText || "\u901A\u8BDD\u5DF2\u7ED3\u675F";
    case CALL_PHASE.error:
      return state.lastStatusText || "\u684C\u9762\u901A\u8BDD\u6682\u4E0D\u53EF\u7528";
    default:
      return "\u684C\u9762\u901A\u8BDD";
  }
}
function getStatusSubline() {
  if (state.phase === CALL_PHASE.idle) {
    return state.initialized ? "" : "\u6B63\u5728\u51C6\u5907\u97F3\u89C6\u9891\u80FD\u529B...";
  }
  if (state.phase === CALL_PHASE.connected || state.phase === CALL_PHASE.outgoing || state.phase === CALL_PHASE.incoming) {
    return "";
  }
  if (state.phase === CALL_PHASE.error || state.phase === CALL_PHASE.ending) {
    return state.activeMessage || "";
  }
  return "";
}
function getSceneNotice() {
  return state.autoplayResumeHint || state.networkHint || state.sessionNotice;
}
function shouldShowIncomingVideoPreview() {
  return state.phase === CALL_PHASE.incoming && state.activeMediaType === CALL_MEDIA.video && state.videoEnabled;
}
function shouldShowVideoScene() {
  return state.activeMediaType === CALL_MEDIA.video && (state.phase === CALL_PHASE.outgoing || state.phase === CALL_PHASE.connected);
}
function shouldShowIncomingActions() {
  return state.phase === CALL_PHASE.incoming;
}
function shouldShowControlBar() {
  return state.phase === CALL_PHASE.outgoing || state.phase === CALL_PHASE.connected;
}
function getViewportWidth() {
  const shellWidth = safeNumber(refs.shell?.clientWidth);
  if (shellWidth > 0) {
    return shellWidth;
  }
  return safeNumber(window.innerWidth || document.documentElement?.clientWidth);
}
function isCompactSizeMode() {
  return getViewportWidth() <= COMPACT_LAYOUT_MAX_WIDTH_PX;
}
function shouldShowDeviceButton() {
  return state.initialized && shouldShowControlBar() && !isCompactSizeMode();
}
function shouldShowIncomingCameraButton() {
  return state.phase === CALL_PHASE.incoming && state.activeMediaType === CALL_MEDIA.video;
}
function shouldShowCameraButton() {
  return state.activeMediaType === CALL_MEDIA.video && shouldShowControlBar() && !isCompactSizeMode();
}
function shouldShowLocalPreview() {
  return state.videoEnabled && (shouldShowVideoScene() || shouldShowIncomingVideoPreview() || isCompactSizeMode() && state.activeMediaType === CALL_MEDIA.video && shouldShowControlBar());
}
function getDeviceTypeLabel(deviceType) {
  if (deviceType === DEVICE_TYPE.camera) {
    return "\u6444\u50CF\u5934";
  }
  if (deviceType === DEVICE_TYPE.speaker) {
    return "\u626C\u58F0\u5668";
  }
  return "\u9EA6\u514B\u98CE";
}
function getDeviceListByType(deviceType) {
  if (deviceType === DEVICE_TYPE.camera) {
    return state.devices.cameraList;
  }
  if (deviceType === DEVICE_TYPE.speaker) {
    return state.devices.speakerList;
  }
  return state.devices.microphoneList;
}
function getCurrentDeviceId(deviceType) {
  if (deviceType === DEVICE_TYPE.camera) {
    return state.devices.currentCamera;
  }
  if (deviceType === DEVICE_TYPE.speaker) {
    return state.devices.currentSpeaker;
  }
  return state.devices.currentMicrophone;
}
function isDeviceEnabled(deviceType) {
  if (deviceType === DEVICE_TYPE.speaker) {
    return state.speakerEnabled;
  }
  if (deviceType === DEVICE_TYPE.camera) {
    return state.videoEnabled;
  }
  if (state.phase === CALL_PHASE.incoming) {
    return state.preferredAudioEnabled;
  }
  return state.audioEnabled;
}
function getDeviceToggleLabel(deviceType) {
  const actionText = isDeviceEnabled(deviceType) ? "\u5173\u95ED" : "\u5F00\u542F";
  return `${actionText}${getDeviceTypeLabel(deviceType)}`;
}
function getRemoteStatusBadges() {
  if (state.phase !== CALL_PHASE.connected) {
    return [];
  }
  const badges = [];
  if (state.remoteAudioObserved && !state.remoteAudioAvailable) {
    badges.push("\u5BF9\u65B9\u9EA6\u514B\u98CE\u5DF2\u5173\u95ED");
  }
  if (state.activeMediaType === CALL_MEDIA.video && state.remoteVideoObserved && !state.remoteVideoAvailable) {
    badges.push("\u5BF9\u65B9\u6444\u50CF\u5934\u5DF2\u5173\u95ED");
  }
  return badges;
}
function shouldShowDevicePopover() {
  if (!state.activeDevicePopover || !state.initialized) {
    return false;
  }
  if (isCompactSizeMode()) {
    return false;
  }
  if (state.activeDevicePopover === DEVICE_TYPE.camera) {
    return state.activeMediaType === CALL_MEDIA.video;
  }
  if (state.activeDevicePopover === DEVICE_TYPE.speaker) {
    return shouldShowControlBar();
  }
  if (state.activeDevicePopover === DEVICE_TYPE.microphone) {
    return shouldShowControlBar() || state.phase === CALL_PHASE.incoming;
  }
  return false;
}
function syncSpeakerOutputState() {
  if (!refs.shell) {
    return;
  }
  refs.shell.querySelectorAll("video, audio").forEach((mediaNode) => {
    if (refs.localPreview?.contains(mediaNode)) {
      return;
    }
    mediaNode.muted = !state.speakerEnabled;
    mediaNode.volume = state.speakerEnabled ? 1 : 0;
  });
}
function getTRTCCloudInstance() {
  if (!state.engine) {
    return null;
  }
  if (typeof state.engine.getTRTCCloudInstance === "function") {
    return state.engine.getTRTCCloudInstance();
  }
  return state.engine.trtcCloud ?? null;
}
async function syncSpeakerOutputStateToEngine() {
  const trtcCloud = getTRTCCloudInstance();
  if (!trtcCloud) {
    return;
  }
  const remoteUserId = safeString(state.remoteUserId || state.peer.id);
  const targetPlayoutVolume = state.speakerEnabled ? 100 : 0;
  try {
    if (typeof trtcCloud.setAudioPlayoutVolume === "function") {
      await Promise.resolve(trtcCloud.setAudioPlayoutVolume(targetPlayoutVolume));
    }
    if (remoteUserId && typeof trtcCloud.setRemoteAudioVolume === "function") {
      trtcCloud.setRemoteAudioVolume(remoteUserId, targetPlayoutVolume);
    }
  } catch (error) {
    console.error("[DesktopCall] sync speaker output to engine failed", error);
  }
}
function bindTRTCCloudEvent(eventName, handler) {
  const trtcCloud = getTRTCCloudInstance();
  if (!trtcCloud || typeof trtcCloud.on !== "function") {
    diagLog("bind_trtc_cloud_event_skipped", {
      eventName,
      hasCloudInstance: Boolean(trtcCloud)
    });
    return;
  }
  const wrapped = async (...args) => {
    diagLog("trtc_cloud_event_received", {
      eventName,
      argCount: args.length,
      phase: state.phase,
      connectionRole: state.connectionRole
    });
    try {
      await handler(...args);
    } catch (error) {
      console.error("[DesktopCall] trtc cloud event failed", eventName, error);
    }
  };
  trtcCloud.on(eventName, wrapped);
  state.trtcCloudListeners.push({
    eventName,
    handler: wrapped
  });
}
function unbindTRTCCloudEvents() {
  const trtcCloud = getTRTCCloudInstance();
  if (!trtcCloud || typeof trtcCloud.off !== "function") {
    state.trtcCloudListeners = [];
    return;
  }
  state.trtcCloudListeners.forEach((item) => {
    try {
      trtcCloud.off(item.eventName, item.handler, void 0);
    } catch (_) {
    }
  });
  state.trtcCloudListeners = [];
}
async function configureTRTCAutoplayHandling() {
  const trtcCloud = getTRTCCloudInstance();
  if (!trtcCloud) {
    diagLog("configure_trtc_autoplay_skipped", {
      reason: "missing_trtc_cloud"
    });
    return;
  }
  if (typeof trtcCloud.callExperimentalAPI === "function") {
    try {
      await Promise.resolve(
        trtcCloud.callExperimentalAPI(
          safeJsonStringify({
            api: "enableAutoPlayDialog",
            params: {
              enable: false
            }
          })
        )
      );
      diagLog("configure_trtc_autoplay_dialog_disabled", {
        phase: state.phase,
        connectionRole: state.connectionRole
      });
    } catch (error) {
      diagLog("configure_trtc_autoplay_dialog_disable_failed", {
        error: trimDiagText(error?.message || error)
      });
      console.warn("[DesktopCall] disable TRTC autoplay dialog failed", error);
    }
  }
  unbindTRTCCloudEvents();
  bindTRTCCloudEvent("onAutoPlayFailed", async () => {
    if (!state.speakerEnabled || state.phase === CALL_PHASE.idle) {
      return;
    }
    setAutoplayResumeHint();
  });
  bindTRTCCloudEvent("onFirstAudioFrame", async () => {
    clearAutoplayResumeHint("first_audio_frame");
  });
}
function getIconSvg(name) {
  if (name === "reject") {
    return TUICALLKIT_ICONS.hangup;
  }
  return TUICALLKIT_ICONS[name] || TUICALLKIT_ICONS.micOn;
}
function getCompactToggleIconSvg() {
  return String.raw`<svg width="22" height="22" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="2.75" width="12.5" height="12.5" rx="1.25" stroke="currentColor" stroke-width="1.5"/>
<path d="M9.75 10.25C9.75 9.97386 9.97386 9.75 10.25 9.75H15.25V14.75C15.25 15.0261 15.0261 15.25 14.75 15.25H9.75V10.25Z" stroke="currentColor" stroke-width="1.5"/>
<path d="M4.75 4.75L8.6 8.6" stroke="currentColor" stroke-width="1.5"/>
<path d="M9.25 5.25V9.25H5.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}
function getRestoreRegularIconSvg() {
  return String.raw`<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="0.769231" y="0.769231" width="18.4615" height="18.4615" rx="0.769231" stroke="currentColor" stroke-width="1.53846"/>
<path d="M11.5385 12.3077C11.5385 11.8829 11.8829 11.5385 12.3077 11.5385H19.2308V18.4615C19.2308 18.8864 18.8864 19.2308 18.4616 19.2308H11.5385V12.3077Z" stroke="currentColor" stroke-width="1.53846"/>
<path d="M11.5385 11.5385L6.92308 6.9231" stroke="currentColor" stroke-width="1.53846"/>
<path d="M13.9231 6.9231H6.92308V13.9231" stroke="currentColor" stroke-width="1.53846" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}
function getFullscreenToggleIconSvg() {
  return String.raw`<svg width="22" height="22" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M6 2.75H2.75V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M12 2.75H15.25V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M6 15.25H2.75V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M12 15.25H15.25V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}
function updateActionButton(button, { active, label, icon, disabled = false, expanded = false }) {
  if (!button) {
    return;
  }
  button.dataset.active = String(Boolean(active));
  button.dataset.disabled = String(Boolean(disabled));
  button.dataset.expanded = String(Boolean(expanded));
  button.disabled = disabled;
  const labelNode = button.querySelector("[data-role='label']");
  const iconNode = button.querySelector("[data-role='icon']");
  if (labelNode) {
    labelNode.textContent = safeString(label);
  }
  if (iconNode) {
    iconNode.innerHTML = getIconSvg(icon);
  }
}
function updateWindowActionButton(button, { icon, title, disabled = false }) {
  if (!button) {
    return;
  }
  button.disabled = disabled;
  button.title = safeString(title);
  button.setAttribute("aria-label", safeString(title));
  const iconNode = button.querySelector("[data-role='icon']");
  if (iconNode) {
    iconNode.innerHTML = icon;
  }
}
function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
function getTopSafeAreaPx() {
  if (!refs.shell) {
    return 32;
  }
  const raw = window.getComputedStyle(refs.shell).getPropertyValue("--desktop-call-top-safe-area");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 32;
}
function getActiveDevicePopoverTriggerNode(deviceType = state.activeDevicePopover) {
  const normalizedType = safeString(deviceType);
  const candidates = [];
  if (normalizedType === DEVICE_TYPE.microphone) {
    candidates.push(refs.micButton);
  } else if (normalizedType === DEVICE_TYPE.speaker) {
    candidates.push(refs.deviceButton);
  } else if (normalizedType === DEVICE_TYPE.camera) {
    candidates.push(refs.incomingCameraButton, refs.cameraButton);
  }
  return candidates.find((node) => node && !node.hidden && node.getClientRects().length > 0) || null;
}
function clearDevicePopoverLayout() {
  [refs.devicePopover, refs.devicePopoverHoverBridge].forEach((node) => {
    if (!node) {
      return;
    }
    node.style.left = "";
    node.style.top = "";
    node.style.bottom = "";
    node.style.width = "";
    node.style.height = "";
    node.style.transform = "";
  });
}
function positionDevicePopover(deviceType = state.activeDevicePopover) {
  if (!refs.shell || !refs.devicePopover || !refs.devicePopoverHoverBridge) {
    return;
  }
  const triggerNode = getActiveDevicePopoverTriggerNode(deviceType);
  if (!triggerNode || refs.devicePopover.hidden) {
    clearDevicePopoverLayout();
    return;
  }
  const shellRect = refs.shell.getBoundingClientRect();
  const triggerRect = triggerNode.getBoundingClientRect();
  const popoverRect = refs.devicePopover.getBoundingClientRect();
  const edgeMargin = DEVICE_POPOVER_EDGE_MARGIN_PX;
  const triggerCenterX = triggerRect.left - shellRect.left + triggerRect.width / 2;
  const maxPopoverLeft = Math.max(edgeMargin, shellRect.width - popoverRect.width - edgeMargin);
  const popoverLeft = clampNumber(
    triggerCenterX - popoverRect.width / 2,
    edgeMargin,
    maxPopoverLeft
  );
  const minPopoverTop = Math.max(edgeMargin, getTopSafeAreaPx() + 12);
  const maxPopoverTop = Math.max(minPopoverTop, shellRect.height - popoverRect.height - edgeMargin);
  const popoverTop = clampNumber(
    triggerRect.top - shellRect.top - popoverRect.height - DEVICE_POPOVER_TRIGGER_GAP_PX,
    minPopoverTop,
    maxPopoverTop
  );
  refs.devicePopover.style.left = `${Math.round(popoverLeft)}px`;
  refs.devicePopover.style.top = `${Math.round(popoverTop)}px`;
  refs.devicePopover.style.bottom = "auto";
  refs.devicePopover.style.transform = "none";
  const maxBridgeWidth = Math.max(96, shellRect.width - edgeMargin * 2);
  const desiredBridgeWidth = Math.max(
    triggerRect.width + 56,
    Math.min(popoverRect.width, 180)
  );
  const bridgeWidth = Math.min(maxBridgeWidth, desiredBridgeWidth);
  const maxBridgeLeft = Math.max(edgeMargin, shellRect.width - bridgeWidth - edgeMargin);
  const bridgeLeft = clampNumber(triggerCenterX - bridgeWidth / 2, edgeMargin, maxBridgeLeft);
  const bridgeTop = Math.round(
    Math.max(edgeMargin, popoverTop + popoverRect.height - DEVICE_POPOVER_BRIDGE_OVERLAP_PX)
  );
  const bridgeBottom = Math.round(
    triggerRect.bottom - shellRect.top + DEVICE_POPOVER_BRIDGE_OVERLAP_PX
  );
  const bridgeHeight = Math.max(DEVICE_POPOVER_BRIDGE_MIN_HEIGHT_PX, bridgeBottom - bridgeTop);
  refs.devicePopoverHoverBridge.style.left = `${Math.round(bridgeLeft)}px`;
  refs.devicePopoverHoverBridge.style.top = `${bridgeTop}px`;
  refs.devicePopoverHoverBridge.style.bottom = "auto";
  refs.devicePopoverHoverBridge.style.width = `${Math.round(bridgeWidth)}px`;
  refs.devicePopoverHoverBridge.style.height = `${bridgeHeight}px`;
  refs.devicePopoverHoverBridge.style.transform = "none";
}
function showDevicePopover(deviceType) {
  const normalizedType = safeString(deviceType);
  clearDevicePopoverCloseTimer();
  state.activeDevicePopover = normalizedType;
  render();
  void refreshDeviceInventoryForType(normalizedType);
}
function clearDevicePopoverCloseTimer() {
  if (devicePopoverCloseTimer) {
    window.clearTimeout(devicePopoverCloseTimer);
    devicePopoverCloseTimer = null;
  }
}
function scheduleDevicePopoverClose(expectedType = state.activeDevicePopover) {
  clearDevicePopoverCloseTimer();
  if (!expectedType) {
    return;
  }
  devicePopoverCloseTimer = window.setTimeout(() => {
    if (state.activeDevicePopover !== expectedType) {
      return;
    }
    state.activeDevicePopover = "";
    devicePopoverCloseTimer = null;
    render();
  }, DEVICE_POPOVER_CLOSE_DELAY_MS);
}
function openDevicePopoverOnHover(deviceType) {
  const normalizedType = safeString(deviceType);
  if (!normalizedType) {
    return;
  }
  showDevicePopover(normalizedType);
}
function syncAvatar(node, imageNode, initialsNode, avatar, name) {
  if (!node || !imageNode || !initialsNode) {
    return;
  }
  const avatarUrl = safeString(avatar);
  if (avatarUrl) {
    imageNode.src = avatarUrl;
    imageNode.hidden = false;
    initialsNode.hidden = true;
    node.dataset.hasAvatar = "true";
  } else {
    imageNode.removeAttribute("src");
    imageNode.hidden = true;
    initialsNode.hidden = false;
    initialsNode.textContent = buildInitials(name);
    node.dataset.hasAvatar = "false";
  }
}
function syncBackdrop(node, avatar) {
  if (!node) {
    return;
  }
  const avatarUrl = safeString(avatar);
  if (avatarUrl) {
    node.style.backgroundImage = `url(${JSON.stringify(avatarUrl)})`;
    node.hidden = false;
    node.dataset.hasAvatar = "true";
    return;
  }
  node.style.backgroundImage = "";
  node.hidden = true;
  node.dataset.hasAvatar = "false";
}
function renderTimerOnly() {
  if (refs.timerBadge) {
    refs.timerBadge.hidden = isCompactSizeMode() || !(state.phase === CALL_PHASE.connected || state.phase === CALL_PHASE.outgoing);
    refs.timerBadge.textContent = state.elapsedLabel;
  }
}
function renderDevicePopover() {
  if (!refs.devicePopover) {
    return;
  }
  const deviceType = state.activeDevicePopover;
  const isVisible = shouldShowDevicePopover();
  refs.devicePopover.hidden = !isVisible;
  if (!isVisible) {
    clearDevicePopoverLayout();
    return;
  }
  const deviceLabel = getDeviceTypeLabel(deviceType);
  const devices = getDeviceListByType(deviceType);
  const currentDeviceId = getCurrentDeviceId(deviceType);
  refs.devicePopover.dataset.deviceType = deviceType;
  refs.devicePopoverTitle.textContent = deviceLabel;
  refs.devicePopoverToggle.dataset.deviceType = deviceType;
  refs.devicePopoverToggle.textContent = getDeviceToggleLabel(deviceType);
  refs.devicePopoverEmpty.hidden = devices.length > 0;
  refs.devicePopoverList.hidden = devices.length === 0;
  refs.devicePopoverEmpty.textContent = `\u672A\u68C0\u6D4B\u5230${deviceLabel}\u8BBE\u5907`;
  refs.devicePopoverList.innerHTML = devices.map((item) => {
    const deviceId = safeString(item?.deviceId);
    const deviceName = escapeHtml(item?.deviceName || item?.label || deviceLabel);
    const selected = deviceId && deviceId === currentDeviceId;
    return `
        <button
          class="desktop-call-device-item"
          type="button"
          data-device-type="${escapeHtml(deviceType)}"
          data-device-id="${escapeHtml(deviceId)}"
          data-selected="${String(selected)}"
        >
          <span class="desktop-call-device-item-name">${deviceName}</span>
          <span class="desktop-call-device-item-check">${selected ? "\u5F53\u524D" : ""}</span>
        </button>
      `;
  }).join("");
  positionDevicePopover(deviceType);
}
function render() {
  if (!refs.shell) {
    return;
  }
  const peer = getDisplayPeer();
  const isCompactMode = isCompactSizeMode();
  const showIncomingPreview = shouldShowIncomingVideoPreview();
  const showIncomingActions = shouldShowIncomingActions();
  const showControlBar = shouldShowControlBar();
  const showRegularWindowActions = showControlBar && !isCompactMode;
  const showCompactControls = showControlBar && isCompactMode;
  const showDevicePopover2 = shouldShowDevicePopover();
  const showIncomingCameraButton = shouldShowIncomingCameraButton();
  const hasRemoteVideo = Boolean(state.remoteVideoAvailable && state.remoteVideoAttachedUserId);
  const hasLocalVideo = state.activeMediaType === CALL_MEDIA.video && Boolean(state.videoEnabled);
  const showCompactVideoFallback = showCompactControls && state.activeMediaType === CALL_MEDIA.video && !hasRemoteVideo && !hasLocalVideo;
  const isVideoScene = shouldShowVideoScene() && !showCompactVideoFallback;
  const noticeText = getSceneNotice();
  const statusSubline = getStatusSubline();
  const remoteStatusBadges = getRemoteStatusBadges();
  const showHeroLoading = state.phase === CALL_PHASE.idle;
  const topTimerVisible = !isCompactMode && (state.phase === CALL_PHASE.connected || state.phase === CALL_PHASE.outgoing);
  const showLocalPreview = shouldShowLocalPreview() && (!isCompactMode || !hasRemoteVideo);
  const showHeroBackdrop = !isCompactMode && !isVideoScene && !showIncomingPreview && state.phase !== CALL_PHASE.idle && Boolean(peer.avatar);
  const showRemoteBackdrop = !isCompactMode && isVideoScene && !hasRemoteVideo && Boolean(peer.avatar);
  const compactPrimaryVideo = hasRemoteVideo ? "remote" : hasLocalVideo ? "local" : "fallback";
  state.sizeMode = isCompactMode ? SIZE_MODE.compact : SIZE_MODE.regular;
  refs.shell.dataset.phase = state.phase;
  refs.shell.dataset.media = state.activeMediaType;
  refs.shell.dataset.sizeMode = state.sizeMode;
  refs.shell.dataset.videoScene = String(isVideoScene);
  refs.shell.dataset.incomingPreview = String(showIncomingPreview);
  refs.shell.dataset.compactPrimaryVideo = compactPrimaryVideo;
  refs.name.textContent = peer.name;
  refs.heroLoading.hidden = !showHeroLoading;
  refs.heroAvatar.hidden = showHeroLoading;
  refs.name.hidden = showHeroLoading;
  refs.headline.textContent = getStatusHeadline();
  refs.headline.hidden = isCompactMode || !refs.headline.textContent;
  refs.subline.textContent = statusSubline;
  refs.subline.hidden = isCompactMode || !statusSubline;
  refs.timerBadge.hidden = !topTimerVisible;
  refs.timerBadge.textContent = state.elapsedLabel;
  refs.fullscreenButton.hidden = !showRegularWindowActions;
  refs.compactButton.hidden = !showRegularWindowActions;
  refs.restoreRegularButton.hidden = !showCompactControls;
  updateWindowActionButton(refs.fullscreenButton, {
    icon: getFullscreenToggleIconSvg(),
    title: "\u5168\u5C4F\u5207\u6362"
  });
  updateWindowActionButton(refs.compactButton, {
    icon: getCompactToggleIconSvg(),
    title: "\u5207\u6362\u4E3A\u5C0F\u7A97"
  });
  updateWindowActionButton(refs.restoreRegularButton, {
    icon: getRestoreRegularIconSvg(),
    title: "\u6062\u590D\u5E38\u89C4\u7A97\u53E3"
  });
  refs.hero.hidden = isVideoScene;
  refs.videoScene.hidden = !isVideoScene;
  refs.controlsView.hidden = !(showIncomingActions || showControlBar && !isCompactMode);
  refs.incomingActions.hidden = !showIncomingActions;
  refs.controlBar.hidden = !(showControlBar && !isCompactMode);
  refs.compactControls.hidden = !showCompactControls;
  refs.devicePopover.hidden = !showDevicePopover2;
  refs.devicePopoverHoverBridge.hidden = !showDevicePopover2;
  refs.deviceButton.hidden = !shouldShowDeviceButton();
  refs.cameraButton.hidden = !shouldShowCameraButton();
  refs.incomingCameraButton.hidden = !showIncomingCameraButton;
  refs.compactCameraButton.hidden = !(showCompactControls && state.activeMediaType === CALL_MEDIA.video);
  refs.remotePlaceholder.hidden = hasRemoteVideo || isCompactMode && hasLocalVideo;
  refs.localPreview.hidden = !showLocalPreview;
  refs.localLabel.hidden = showIncomingPreview || isCompactMode;
  refs.heroNotice.hidden = isVideoScene || !noticeText || isCompactMode;
  refs.videoNotice.hidden = !isVideoScene || !noticeText || isCompactMode;
  refs.heroNotice.textContent = noticeText;
  refs.videoNotice.textContent = noticeText;
  refs.remoteWaiting.textContent = "";
  refs.remoteWaiting.hidden = true;
  refs.videoLabel.textContent = peer.name;
  refs.videoSubtitle.textContent = "";
  refs.videoSubtitle.hidden = isCompactMode || !refs.videoSubtitle.textContent;
  refs.remoteStatus.hidden = isCompactMode || remoteStatusBadges.length === 0;
  refs.remoteStatus.innerHTML = remoteStatusBadges.map((text) => `<div class="desktop-call-status-chip">${escapeHtml(text)}</div>`).join("");
  updateActionButton(refs.micButton, {
    active: state.audioEnabled,
    label: "\u9EA6\u514B\u98CE",
    icon: state.audioEnabled ? "micOn" : "micOff",
    expanded: state.activeDevicePopover === DEVICE_TYPE.microphone
  });
  updateActionButton(refs.deviceButton, {
    active: state.speakerEnabled,
    label: getDeviceTypeLabel(DEVICE_TYPE.speaker),
    icon: state.speakerEnabled ? "speakerOn" : "speakerOff",
    expanded: state.activeDevicePopover === DEVICE_TYPE.speaker
  });
  updateActionButton(refs.cameraButton, {
    active: state.videoEnabled,
    label: getDeviceTypeLabel(DEVICE_TYPE.camera),
    icon: state.videoEnabled ? "cameraOn" : "cameraOff",
    expanded: state.activeDevicePopover === DEVICE_TYPE.camera
  });
  updateActionButton(refs.incomingCameraButton, {
    active: state.videoEnabled,
    label: getDeviceTypeLabel(DEVICE_TYPE.camera),
    icon: state.videoEnabled ? "cameraOn" : "cameraOff",
    expanded: state.activeDevicePopover === DEVICE_TYPE.camera
  });
  updateActionButton(refs.compactMicButton, {
    active: state.audioEnabled,
    label: "",
    icon: state.audioEnabled ? "micOn" : "micOff"
  });
  updateActionButton(refs.compactSpeakerButton, {
    active: state.speakerEnabled,
    label: "",
    icon: state.speakerEnabled ? "speakerOn" : "speakerOff"
  });
  updateActionButton(refs.compactCameraButton, {
    active: state.videoEnabled,
    label: "",
    icon: state.videoEnabled ? "cameraOn" : "cameraOff"
  });
  updateActionButton(refs.compactHangupButton, {
    active: false,
    label: "",
    icon: "hangup"
  });
  syncAvatar(refs.heroAvatar, refs.heroAvatarImage, refs.heroAvatarInitials, peer.avatar, peer.name);
  syncAvatar(
    refs.remoteAvatar,
    refs.remoteAvatarImage,
    refs.remoteAvatarInitials,
    peer.avatar,
    peer.name
  );
  syncBackdrop(refs.heroBackdrop, showHeroBackdrop ? peer.avatar : "");
  syncBackdrop(refs.remoteBackdrop, showRemoteBackdrop ? peer.avatar : "");
  refs.hero.dataset.backdrop = String(showHeroBackdrop);
  refs.remotePlaceholder.dataset.backdrop = String(showRemoteBackdrop);
  renderDevicePopover();
  syncSpeakerOutputState();
  emitStateSnapshot();
}
function mountShell() {
  root.innerHTML = `
    <style>
      :root {
        color-scheme: dark;
        --desktop-call-top-safe-area: 32px;
      }

      * {
        box-sizing: border-box;
      }

      [hidden] {
        display: none !important;
      }

      .desktop-call-shell {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        color: #ffffff;
        font-family: "PingFang SC", "SF Pro Display", "Helvetica Neue", sans-serif;
        background:
          radial-gradient(circle at 50% 18%, rgba(111, 120, 138, 0.28), transparent 18%),
          radial-gradient(circle at 50% 88%, rgba(111, 120, 138, 0.2), transparent 28%),
          linear-gradient(180deg, #353a45 0%, #2f343d 100%);
      }

      .desktop-call-shell::before {
        content: "";
        position: absolute;
        top: 44px;
        left: 50%;
        width: min(46vw, 220px);
        height: min(46vw, 220px);
        transform: translateX(-50%);
        border-radius: 50%;
        background: rgba(118, 128, 143, 0.18);
        filter: blur(34px);
        pointer-events: none;
        transition: opacity 180ms ease;
      }

      .desktop-call-shell::after {
        content: "";
        position: absolute;
        left: 50%;
        bottom: -44px;
        width: min(72vw, 420px);
        height: min(72vw, 420px);
        transform: translateX(-50%);
        border-radius: 50%;
        background: rgba(118, 128, 143, 0.14);
        filter: blur(56px);
        pointer-events: none;
        transition: opacity 180ms ease;
      }

      .desktop-call-shell[data-phase="outgoing"][data-media="video"],
      .desktop-call-shell[data-phase="connected"][data-media="video"],
      .desktop-call-shell[data-incoming-preview="true"] {
        background: #000000;
      }

      .desktop-call-shell[data-phase="outgoing"][data-media="video"]::before,
      .desktop-call-shell[data-phase="outgoing"][data-media="video"]::after,
      .desktop-call-shell[data-phase="connected"][data-media="video"]::before,
      .desktop-call-shell[data-phase="connected"][data-media="video"]::after,
      .desktop-call-shell[data-incoming-preview="true"]::before,
      .desktop-call-shell[data-incoming-preview="true"]::after {
        opacity: 0;
      }

      .desktop-call-timer {
        position: relative;
        z-index: 9;
        position: absolute;
        top: calc(var(--desktop-call-top-safe-area) - 26px);
        left: 50%;
        transform: translateX(-50%);
        display: inline-block;
        padding: 0;
        color: rgba(255, 255, 255, 0.96);
        font-size: 18px;
        font-weight: 400;
        letter-spacing: 0.02em;
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
      }

      .desktop-call-window-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        background: rgba(6, 9, 13, 0.42);
        backdrop-filter: blur(18px);
        color: rgba(255, 255, 255, 0.94);
        cursor: pointer;
        transition:
          background-color 180ms ease,
          border-color 180ms ease,
          transform 180ms ease;
      }

      .desktop-call-window-action:hover,
      .desktop-call-window-action:focus-visible {
        background: rgba(12, 16, 23, 0.64);
        border-color: rgba(255, 255, 255, 0.2);
        transform: translateY(-1px);
      }

      .desktop-call-window-action:focus-visible {
        outline: none;
      }

      .desktop-call-window-action svg {
        width: 18px;
        height: 18px;
      }

      .desktop-call-window-action[data-action="toggle-fullscreen"] svg,
      .desktop-call-window-action[data-action="toggle-compact-mode"] svg {
        width: 22px;
        height: 22px;
      }

      .desktop-call-window-actions {
        position: absolute;
        top: calc(var(--desktop-call-top-safe-area) + 14px);
        right: 18px;
        z-index: 10;
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: flex-end;
      }

      .desktop-call-window-action-stack {
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: flex-end;
      }

      .desktop-call-hero {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: calc(var(--desktop-call-top-safe-area) + 18px) 28px 154px;
        text-align: center;
        z-index: 2;
      }

      .desktop-call-backdrop {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        pointer-events: none;
      }

      .desktop-call-backdrop::before {
        content: "";
        position: absolute;
        inset: -6%;
        background: inherit;
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        transform: scale(1.08);
        filter: blur(18px) saturate(0.88);
      }

      .desktop-call-backdrop::after {
        content: "";
        position: absolute;
        inset: 0;
        background:
          linear-gradient(180deg, rgba(12, 15, 22, 0.44) 0%, rgba(12, 15, 22, 0.62) 100%),
          radial-gradient(circle at 50% 46%, rgba(17, 20, 28, 0.1) 0%, rgba(17, 20, 28, 0.52) 82%);
      }

      .desktop-call-hero-backdrop {
        z-index: 0;
      }

      .desktop-call-hero-content,
      .desktop-call-video-overlay-card {
        position: relative;
        z-index: 1;
      }

      .desktop-call-hero-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: min(100%, 560px);
      }

      .desktop-call-loading {
        position: relative;
        display: grid;
        place-items: center;
        width: 132px;
        height: 132px;
        border-radius: 999px;
        background:
          radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.05) 52%, rgba(255, 255, 255, 0.02) 100%);
        box-shadow:
          0 18px 46px rgba(0, 0, 0, 0.28),
          inset 0 1px 0 rgba(255, 255, 255, 0.08);
      }

      .desktop-call-loading-ring,
      .desktop-call-loading-ring::before {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        content: "";
      }

      .desktop-call-loading-ring {
        border: 2px solid rgba(255, 255, 255, 0.08);
        border-top-color: rgba(255, 255, 255, 0.9);
        animation: desktop-call-loading-spin 1200ms linear infinite;
      }

      .desktop-call-loading-ring::before {
        inset: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        opacity: 0.72;
        animation: desktop-call-loading-pulse 1800ms ease-in-out infinite;
      }

      .desktop-call-loading-core {
        position: relative;
        display: inline-flex;
        gap: 8px;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
      }

      .desktop-call-loading-dot {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 0 14px rgba(255, 255, 255, 0.16);
        animation: desktop-call-loading-dot 1200ms ease-in-out infinite;
      }

      .desktop-call-loading-dot:nth-child(2) {
        animation-delay: 160ms;
      }

      .desktop-call-loading-dot:nth-child(3) {
        animation-delay: 320ms;
      }

      @keyframes desktop-call-loading-spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes desktop-call-loading-pulse {
        0%,
        100% {
          opacity: 0.32;
          transform: scale(0.94);
        }
        50% {
          opacity: 0.82;
          transform: scale(1);
        }
      }

      @keyframes desktop-call-loading-dot {
        0%,
        80%,
        100% {
          opacity: 0.35;
          transform: translateY(0) scale(0.88);
        }
        40% {
          opacity: 1;
          transform: translateY(-3px) scale(1.02);
        }
      }

      .desktop-call-avatar {
        position: relative;
        display: grid;
        place-items: center;
        width: 118px;
        height: 118px;
        border-radius: 999px;
        background: linear-gradient(180deg, #505762 0%, #474d58 100%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        overflow: hidden;
        box-shadow: 0 18px 46px rgba(0, 0, 0, 0.28);
      }

      .desktop-call-avatar[data-size="large"] {
        width: 132px;
        height: 132px;
      }

      .desktop-call-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .desktop-call-avatar-initials {
        font-size: 34px;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: rgba(255, 255, 255, 0.92);
      }

      .desktop-call-name {
        margin-top: 28px;
        font-size: clamp(36px, 6vw, 48px);
        font-weight: 700;
        letter-spacing: 0.01em;
        text-align: center;
      }

      .desktop-call-headline {
        margin-top: 28px;
        font-size: 18px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.92);
        text-align: center;
      }

      .desktop-call-subline {
        max-width: 460px;
        margin-top: 12px;
        color: rgba(255, 255, 255, 0.6);
        font-size: 14px;
        line-height: 1.6;
        text-align: center;
      }

      .desktop-call-notice {
        position: absolute;
        left: 50%;
        top: 54%;
        transform: translate(-50%, -50%);
        z-index: 5;
        max-width: calc(100% - 44px);
        padding: 11px 18px;
        border-radius: 999px;
        background: rgba(8, 11, 16, 0.42);
        border: 1px solid rgba(255, 255, 255, 0.12);
        backdrop-filter: blur(18px);
        color: rgba(255, 255, 255, 0.92);
        font-size: 14px;
        text-align: center;
        line-height: 1.5;
      }

      .desktop-call-hero-notice {
        position: static;
        transform: none;
        margin-top: 20px;
      }

      .desktop-call-video-scene {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #000000;
        z-index: 1;
      }

      .desktop-call-remote-status {
        position: absolute;
        top: calc(var(--desktop-call-top-safe-area) + 108px);
        right: 18px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: flex-end;
        z-index: 9;
        max-width: min(280px, calc(100% - 36px));
      }

      .desktop-call-status-chip {
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(8, 11, 16, 0.58);
        border: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(18px);
        color: rgba(255, 255, 255, 0.9);
        font-size: 12px;
        line-height: 1.35;
        text-align: center;
      }

      .desktop-call-video-remote,
      .desktop-call-video-local {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #060707;
      }

      .desktop-call-video-remote {
        inset: 0;
      }

      .desktop-call-video-local {
        top: calc(var(--desktop-call-top-safe-area) + 14px);
        left: 18px;
        width: min(28vw, 260px);
        height: min(21vw, 196px);
        border-radius: 20px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        box-shadow: 0 18px 36px rgba(0, 0, 0, 0.42);
        z-index: 6;
      }

      .desktop-call-video-local::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(
          180deg,
          rgba(10, 14, 18, 0.1) 0%,
          rgba(10, 14, 18, 0.18) 100%
        );
        pointer-events: none;
      }

      .desktop-call-shell[data-incoming-preview="true"] .desktop-call-video-local {
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border-radius: 0;
        border: 0;
        box-shadow: none;
        z-index: 1;
      }

      .desktop-call-shell[data-incoming-preview="true"] .desktop-call-video-local::after {
        background: linear-gradient(
          180deg,
          rgba(20, 24, 30, 0.44) 0%,
          rgba(20, 24, 30, 0.28) 38%,
          rgba(20, 24, 30, 0.58) 100%
        );
      }

      .desktop-call-video-surface {
        width: 100%;
        height: 100%;
      }

      .desktop-call-video-remote .desktop-call-video-surface video {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .desktop-call-video-local .desktop-call-video-surface video {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .desktop-call-shell[data-incoming-preview="true"] .desktop-call-video-surface video {
        filter: saturate(0.94) brightness(0.92);
      }

      .desktop-call-video-overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 32px;
        z-index: 3;
      }

      .desktop-call-video-overlay-card {
        display: grid;
        justify-items: center;
        gap: 16px;
        padding: 0;
        text-align: center;
      }

      .desktop-call-remote-backdrop {
        z-index: 0;
      }

      .desktop-call-video-title {
        font-size: clamp(26px, 4vw, 34px);
        font-weight: 600;
        line-height: 1.15;
      }

      .desktop-call-video-subtitle {
        color: rgba(255, 255, 255, 0.76);
        font-size: 14px;
        text-align: center;
      }

      .desktop-call-local-label {
        position: absolute;
        left: 10px;
        bottom: 10px;
        padding: 5px 10px;
        border-radius: 999px;
        background: rgba(8, 11, 16, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.9);
        font-size: 12px;
        z-index: 7;
      }

      .desktop-call-controls {
        position: absolute;
        left: 50%;
        bottom: 28px;
        transform: translateX(-50%);
        width: calc(100% - 36px);
        display: flex;
        justify-content: center;
        z-index: 10;
      }

      .desktop-call-action-row,
      .desktop-call-live-row {
        display: flex;
        gap: 24px;
        align-items: flex-end;
        justify-content: center;
        flex-wrap: wrap;
      }

      .desktop-call-button {
        display: grid;
        justify-items: center;
        gap: 8px;
        min-width: 78px;
        padding: 0;
        border: 0;
        background: transparent;
        color: #ffffff;
        font: inherit;
        cursor: pointer;
        transition: opacity 180ms ease;
      }

      .desktop-call-button:hover .desktop-call-button-icon,
      .desktop-call-button:focus-visible .desktop-call-button-icon {
        transform: translateY(-1px);
      }

      .desktop-call-button:disabled {
        cursor: default;
      }

      .desktop-call-button[data-disabled="true"] {
        opacity: 0.64;
      }

      .desktop-call-button-icon {
        display: grid;
        place-items: center;
        width: 62px;
        height: 62px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        color: rgba(255, 255, 255, 0.98);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.26);
        transition:
          transform 180ms ease,
          background-color 180ms ease,
          color 180ms ease,
          border-color 180ms ease;
      }

      .desktop-call-button-icon svg {
        width: 26px;
        height: 26px;
      }

      .desktop-call-button[data-tone="positive"] .desktop-call-button-icon {
        background: #49c56b;
        color: #ffffff;
      }

      .desktop-call-button[data-tone="danger"] .desktop-call-button-icon {
        background: #f55360;
        color: #ffffff;
      }

      .desktop-call-button[data-active="true"][data-tone="neutral"] .desktop-call-button-icon {
        background: rgba(255, 255, 255, 0.96);
        color: #1b1f27;
        border-color: rgba(255, 255, 255, 0.98);
      }

      .desktop-call-button[data-expanded="true"] .desktop-call-button-icon {
        border-color: rgba(255, 255, 255, 0.42);
        box-shadow: 0 16px 30px rgba(0, 0, 0, 0.34);
      }

      .desktop-call-button-label {
        max-width: 78px;
        color: rgba(255, 255, 255, 0.76);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.01em;
        line-height: 1.35;
        text-align: center;
      }

      .desktop-call-button[data-tone="positive"] .desktop-call-button-label,
      .desktop-call-button[data-tone="danger"] .desktop-call-button-label,
      .desktop-call-button[data-active="true"][data-tone="neutral"] .desktop-call-button-label {
        color: rgba(255, 255, 255, 0.96);
      }

      .desktop-call-compact-controls {
        position: absolute;
        left: 50%;
        bottom: 16px;
        transform: translateX(-50%);
        z-index: 12;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        width: calc(100% - 18px);
      }

      .desktop-call-compact-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 100%;
      }

      .desktop-call-compact-button {
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        background: transparent;
        color: #ffffff;
        cursor: pointer;
      }

      .desktop-call-compact-button:disabled {
        cursor: default;
      }

      .desktop-call-compact-button-icon {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.2);
        color: rgba(255, 255, 255, 0.98);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.26);
        transition:
          transform 180ms ease,
          background-color 180ms ease,
          color 180ms ease,
          border-color 180ms ease;
      }

      .desktop-call-compact-button:hover .desktop-call-compact-button-icon,
      .desktop-call-compact-button:focus-visible .desktop-call-compact-button-icon {
        transform: translateY(-1px);
      }

      .desktop-call-compact-button-icon svg {
        width: 18px;
        height: 18px;
      }

      .desktop-call-compact-button[data-tone="danger"] .desktop-call-compact-button-icon {
        background: #f55360;
        color: #ffffff;
      }

      .desktop-call-compact-button[data-active="true"][data-tone="neutral"] .desktop-call-compact-button-icon {
        background: rgba(255, 255, 255, 0.96);
        color: #1b1f27;
        border-color: rgba(255, 255, 255, 0.98);
      }

      .desktop-call-shell[data-size-mode="compact"] {
        background:
          radial-gradient(circle at 50% 20%, rgba(111, 120, 138, 0.18), transparent 30%),
          linear-gradient(180deg, #353a45 0%, #2f343d 100%);
      }

      .desktop-call-shell[data-size-mode="compact"][data-media="video"][data-compact-primary-video="remote"],
      .desktop-call-shell[data-size-mode="compact"][data-media="video"][data-compact-primary-video="local"] {
        background: #000000;
      }

      .desktop-call-shell[data-size-mode="compact"]::before,
      .desktop-call-shell[data-size-mode="compact"]::after {
        opacity: 0;
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-window-actions {
        top: calc(var(--desktop-call-top-safe-area) - 22px);
        right: 10px;
        gap: 6px;
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-window-action {
        width: 30px;
        height: 30px;
        border-radius: 11px;
        backdrop-filter: blur(14px);
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-window-action svg {
        width: 16px;
        height: 16px;
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-hero {
        padding: calc(var(--desktop-call-top-safe-area) + 24px) 18px 112px;
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-hero-content {
        width: 100%;
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-avatar,
      .desktop-call-shell[data-size-mode="compact"] .desktop-call-avatar[data-size="large"] {
        width: 64px;
        height: 64px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-loading {
        width: 74px;
        height: 74px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-loading-ring::before {
        inset: 8px;
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-loading-core {
        gap: 5px;
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-loading-dot {
        width: 6px;
        height: 6px;
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-avatar-initials {
        font-size: 24px;
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-name {
        margin-top: 14px;
        font-size: 15px;
        font-weight: 600;
        line-height: 1.35;
        max-width: 100%;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-video-remote .desktop-call-video-surface video,
      .desktop-call-shell[data-size-mode="compact"] .desktop-call-video-local .desktop-call-video-surface video {
        object-fit: cover;
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-video-local {
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border-radius: 0;
        border: 0;
        box-shadow: none;
        z-index: 2;
      }

      .desktop-call-shell[data-size-mode="compact"] .desktop-call-video-local::after {
        background: linear-gradient(
          180deg,
          rgba(16, 20, 24, 0.16) 0%,
          rgba(16, 20, 24, 0.34) 100%
        );
      }

      .desktop-call-device-popover {
        position: absolute;
        left: 50%;
        bottom: 126px;
        transform: translateX(-50%);
        width: min(360px, calc(100% - 32px));
        padding: 16px;
        border-radius: 20px;
        z-index: 11;
        background: rgba(10, 13, 18, 0.88);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 22px 40px rgba(0, 0, 0, 0.36);
        backdrop-filter: blur(22px);
      }

      .desktop-call-device-popover-hover-bridge {
        position: absolute;
        left: 50%;
        bottom: 74px;
        transform: translateX(-50%);
        width: min(420px, calc(100% - 20px));
        height: 72px;
        z-index: 10;
        background: transparent;
      }

      .desktop-call-device-title {
        margin-bottom: 12px;
        font-size: 14px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.92);
      }

      .desktop-call-device-toggle {
        width: 100%;
        margin-bottom: 12px;
        min-height: 42px;
        padding: 0 14px;
        border: 0;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.96);
        text-align: left;
        font: inherit;
        cursor: pointer;
      }

      .desktop-call-device-list {
        display: grid;
        gap: 12px;
      }

      .desktop-call-device-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        min-height: 44px;
        padding: 0 14px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.92);
        font: inherit;
        cursor: pointer;
      }

      .desktop-call-device-item[data-selected="true"] {
        border-color: rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.14);
      }

      .desktop-call-device-item-name {
        color: rgba(255, 255, 255, 0.92);
        font-size: 12px;
      }

      .desktop-call-device-item-check {
        flex: none;
        color: rgba(255, 255, 255, 0.66);
        font-size: 11px;
      }

      .desktop-call-device-empty {
        color: rgba(255, 255, 255, 0.6);
        font-size: 12px;
        line-height: 1.5;
      }

      @media (max-width: 720px) {
        .desktop-call-name {
          margin-top: 24px;
          font-size: 34px;
        }

        .desktop-call-headline {
          margin-top: 22px;
          font-size: 17px;
        }

        .desktop-call-video-local {
          top: calc(var(--desktop-call-top-safe-area) + 10px);
          left: 14px;
          width: 148px;
          height: 112px;
        }

        .desktop-call-controls {
          bottom: 18px;
          width: calc(100% - 20px);
        }

        .desktop-call-action-row,
        .desktop-call-live-row {
          gap: 18px;
        }

        .desktop-call-button-icon {
          width: 58px;
          height: 58px;
        }

        .desktop-call-device-popover {
          bottom: 108px;
        }

        .desktop-call-device-popover-hover-bridge {
          bottom: 62px;
          height: 64px;
        }

        .desktop-call-remote-status {
          top: calc(var(--desktop-call-top-safe-area) + 100px);
          right: 12px;
        }

        .desktop-call-timer {
          top: calc(var(--desktop-call-top-safe-area) - 32px);
          left: 50%;
          font-size: 16px;
        }

        .desktop-call-window-actions {
          top: calc(var(--desktop-call-top-safe-area) + 8px);
          right: 12px;
        }

        .desktop-call-window-action {
          width: 34px;
          height: 34px;
          border-radius: 11px;
        }
      }

      @media (max-width: 420px) and (max-height: 700px) {
        .desktop-call-device-popover {
          bottom: 154px;
          width: min(332px, calc(100% - 16px));
          padding: 14px;
        }

        .desktop-call-device-popover-hover-bridge {
          bottom: 62px;
          width: min(360px, calc(100% - 12px));
          height: 104px;
        }
      }
    </style>
    <div class="desktop-call-shell" data-desktop-call-shell="true">
      <div class="desktop-call-timer" id="timer-badge" hidden>00:00</div>
      <div class="desktop-call-window-actions" id="window-actions">
        <div class="desktop-call-window-action-stack">
          <button
            class="desktop-call-window-action"
            id="button-toggle-fullscreen"
            type="button"
            data-action="toggle-fullscreen"
            aria-label="\u5168\u5C4F\u5207\u6362"
            title="\u5168\u5C4F\u5207\u6362"
            hidden
          >
            <span data-role="icon">${getFullscreenToggleIconSvg()}</span>
          </button>
          <button
            class="desktop-call-window-action"
            id="button-toggle-compact"
            type="button"
            data-action="toggle-compact-mode"
            aria-label="\u5207\u6362\u4E3A\u5C0F\u7A97"
            title="\u5207\u6362\u4E3A\u5C0F\u7A97"
            hidden
          >
            <span data-role="icon">${getCompactToggleIconSvg()}</span>
          </button>
        </div>
        <button
          class="desktop-call-window-action"
          id="button-restore-regular"
          type="button"
          data-action="restore-regular-window"
          aria-label="\u6062\u590D\u5E38\u89C4\u7A97\u53E3"
          title="\u6062\u590D\u5E38\u89C4\u7A97\u53E3"
          hidden
        >
          <span data-role="icon">${getRestoreRegularIconSvg()}</span>
        </button>
      </div>

      <div class="desktop-call-device-popover-hover-bridge" id="device-popover-hover-bridge" hidden></div>

      <section class="desktop-call-device-popover" id="device-popover" hidden>
        <div class="desktop-call-device-title" id="device-popover-title">\u8BBE\u5907\u5207\u6362</div>
        <button class="desktop-call-device-toggle" id="device-popover-toggle" type="button">
          \u5F00\u542F\u8BBE\u5907
        </button>
        <div class="desktop-call-device-list" id="device-popover-list" hidden></div>
        <div class="desktop-call-device-empty" id="device-popover-empty" hidden>\u672A\u68C0\u6D4B\u5230\u8BBE\u5907</div>
      </section>

      <div class="desktop-call-remote-status" id="remote-status" hidden></div>

      <div class="desktop-call-video-local" id="local-preview" hidden>
        <div class="desktop-call-video-surface" id="${LOCAL_VIDEO_ID}"></div>
        <div class="desktop-call-local-label" id="local-label">\u6211</div>
      </div>

      <section class="desktop-call-hero" id="hero-view">
        <div class="desktop-call-backdrop desktop-call-hero-backdrop" id="hero-backdrop" hidden></div>
        <div class="desktop-call-hero-content">
          <div class="desktop-call-loading" id="hero-loading" hidden>
            <div class="desktop-call-loading-ring"></div>
            <div class="desktop-call-loading-core" aria-hidden="true">
              <span class="desktop-call-loading-dot"></span>
              <span class="desktop-call-loading-dot"></span>
              <span class="desktop-call-loading-dot"></span>
            </div>
          </div>
          <div class="desktop-call-avatar" data-size="large" id="hero-avatar">
            <img id="hero-avatar-image" alt="" hidden />
            <div class="desktop-call-avatar-initials" id="hero-avatar-initials">J</div>
          </div>
          <div class="desktop-call-name" id="call-name">\u684C\u9762\u901A\u8BDD</div>
          <div class="desktop-call-headline" id="call-headline">\u6B63\u5728\u521D\u59CB\u5316\u684C\u9762\u901A\u8BDD...</div>
          <div class="desktop-call-subline" id="call-subline">\u6B63\u5728\u8FDE\u63A5\u97F3\u89C6\u9891\u670D\u52A1</div>
          <div class="desktop-call-notice desktop-call-hero-notice" id="hero-notice" hidden></div>
        </div>
      </section>

      <section class="desktop-call-video-scene" id="video-scene" hidden>
        <div class="desktop-call-video-remote">
          <div class="desktop-call-video-surface" id="${REMOTE_VIDEO_ID}"></div>
          <div class="desktop-call-video-overlay" id="remote-placeholder">
            <div class="desktop-call-backdrop desktop-call-remote-backdrop" id="remote-backdrop" hidden></div>
            <div class="desktop-call-video-overlay-card">
              <div class="desktop-call-avatar" data-size="large" id="remote-avatar">
                <img id="remote-avatar-image" alt="" hidden />
                <div class="desktop-call-avatar-initials" id="remote-avatar-initials">J</div>
              </div>
              <div class="desktop-call-video-title" id="video-label">Jotmo \u7528\u6237</div>
              <div class="desktop-call-video-subtitle" id="video-subtitle">\u89C6\u9891\u901A\u8BDD\u4E2D</div>
              <div class="desktop-call-video-subtitle" id="remote-waiting">\u7B49\u5F85\u5BF9\u65B9\u753B\u9762\u63A5\u5165</div>
            </div>
          </div>
        </div>
        <div class="desktop-call-notice" id="video-notice" hidden></div>
      </section>

      <section class="desktop-call-controls" id="controls-view" hidden>
        <div class="desktop-call-action-row" id="incoming-actions" hidden>
          <button class="desktop-call-button" data-tone="danger" data-action="reject">
            <span class="desktop-call-button-icon" data-role="icon">${getIconSvg("reject")}</span>
            <span class="desktop-call-button-label">\u62D2\u7EDD</span>
          </button>
          <button
            class="desktop-call-button"
            data-tone="neutral"
            data-active="false"
            data-action="open-camera-popover"
            data-device-popover-trigger="true"
            id="button-incoming-camera"
            hidden
          >
            <span class="desktop-call-button-icon" data-role="icon">${getIconSvg("cameraOff")}</span>
            <span class="desktop-call-button-label" data-role="label">\u6444\u50CF\u5934</span>
          </button>
          <button class="desktop-call-button" data-tone="positive" data-action="accept">
            <span class="desktop-call-button-icon" data-role="icon">${getIconSvg("accept")}</span>
            <span class="desktop-call-button-label">\u63A5\u542C</span>
          </button>
        </div>

        <div class="desktop-call-live-row" id="control-bar" hidden>
          <button
            class="desktop-call-button"
            data-tone="neutral"
            data-active="false"
            data-action="open-microphone-popover"
            data-device-popover-trigger="true"
            id="button-toggle-mic"
          >
            <span class="desktop-call-button-icon" data-role="icon">${getIconSvg("micOff")}</span>
            <span class="desktop-call-button-label" data-role="label">\u9EA6\u514B\u98CE</span>
          </button>
          <button
            class="desktop-call-button"
            data-tone="neutral"
            data-active="false"
            data-action="open-speaker-popover"
            data-device-popover-trigger="true"
            id="button-devices"
          >
            <span class="desktop-call-button-icon" data-role="icon">${getIconSvg("speakerOn")}</span>
            <span class="desktop-call-button-label" data-role="label">\u626C\u58F0\u5668</span>
          </button>
          <button
            class="desktop-call-button"
            data-tone="neutral"
            data-active="false"
            data-action="open-camera-popover"
            data-device-popover-trigger="true"
            id="button-toggle-camera"
          >
            <span class="desktop-call-button-icon" data-role="icon">${getIconSvg("cameraOff")}</span>
            <span class="desktop-call-button-label" data-role="label">\u6444\u50CF\u5934</span>
          </button>
          <button class="desktop-call-button" data-tone="danger" data-action="hangup">
            <span class="desktop-call-button-icon" data-role="icon">${getIconSvg("hangup")}</span>
            <span class="desktop-call-button-label">\u6302\u65AD</span>
          </button>
        </div>
      </section>

      <section class="desktop-call-compact-controls" id="compact-controls" hidden>
        <div class="desktop-call-compact-row">
          <button
            class="desktop-call-compact-button"
            data-tone="neutral"
            data-active="false"
            data-action="open-microphone-popover"
            id="button-compact-mic"
          >
            <span class="desktop-call-compact-button-icon" data-role="icon">${getIconSvg("micOff")}</span>
          </button>
          <button
            class="desktop-call-compact-button"
            data-tone="neutral"
            data-active="false"
            data-action="open-speaker-popover"
            id="button-compact-speaker"
          >
            <span class="desktop-call-compact-button-icon" data-role="icon">${getIconSvg("speakerOn")}</span>
          </button>
          <button
            class="desktop-call-compact-button"
            data-tone="neutral"
            data-active="false"
            data-action="open-camera-popover"
            id="button-compact-camera"
            hidden
          >
            <span class="desktop-call-compact-button-icon" data-role="icon">${getIconSvg("cameraOff")}</span>
          </button>
        </div>
        <div class="desktop-call-compact-row">
          <button
            class="desktop-call-compact-button"
            data-tone="danger"
            data-action="hangup"
            id="button-compact-hangup"
          >
            <span class="desktop-call-compact-button-icon" data-role="icon">${getIconSvg("hangup")}</span>
          </button>
        </div>
      </section>
    </div>
  `;
  refs.shell = root.querySelector(".desktop-call-shell");
  refs.hero = document.getElementById("hero-view");
  refs.videoScene = document.getElementById("video-scene");
  refs.name = document.getElementById("call-name");
  refs.headline = document.getElementById("call-headline");
  refs.subline = document.getElementById("call-subline");
  refs.timerBadge = document.getElementById("timer-badge");
  refs.devicePopoverHoverBridge = document.getElementById("device-popover-hover-bridge");
  refs.devicePopover = document.getElementById("device-popover");
  refs.devicePopoverTitle = document.getElementById("device-popover-title");
  refs.devicePopoverToggle = document.getElementById("device-popover-toggle");
  refs.devicePopoverList = document.getElementById("device-popover-list");
  refs.devicePopoverEmpty = document.getElementById("device-popover-empty");
  refs.remoteStatus = document.getElementById("remote-status");
  refs.heroNotice = document.getElementById("hero-notice");
  refs.videoNotice = document.getElementById("video-notice");
  refs.heroBackdrop = document.getElementById("hero-backdrop");
  refs.heroLoading = document.getElementById("hero-loading");
  refs.heroAvatar = document.getElementById("hero-avatar");
  refs.heroAvatarImage = document.getElementById("hero-avatar-image");
  refs.heroAvatarInitials = document.getElementById("hero-avatar-initials");
  refs.remoteBackdrop = document.getElementById("remote-backdrop");
  refs.remoteAvatar = document.getElementById("remote-avatar");
  refs.remoteAvatarImage = document.getElementById("remote-avatar-image");
  refs.remoteAvatarInitials = document.getElementById("remote-avatar-initials");
  refs.remotePlaceholder = document.getElementById("remote-placeholder");
  refs.remoteSurface = document.getElementById(REMOTE_VIDEO_ID);
  refs.remoteWaiting = document.getElementById("remote-waiting");
  refs.videoLabel = document.getElementById("video-label");
  refs.videoSubtitle = document.getElementById("video-subtitle");
  refs.localPreview = document.getElementById("local-preview");
  refs.localLabel = document.getElementById("local-label");
  refs.incomingActions = document.getElementById("incoming-actions");
  refs.controlBar = document.getElementById("control-bar");
  refs.controlsView = document.getElementById("controls-view");
  refs.fullscreenButton = document.getElementById("button-toggle-fullscreen");
  refs.compactButton = document.getElementById("button-toggle-compact");
  refs.restoreRegularButton = document.getElementById("button-restore-regular");
  refs.micButton = document.getElementById("button-toggle-mic");
  refs.cameraButton = document.getElementById("button-toggle-camera");
  refs.incomingCameraButton = document.getElementById("button-incoming-camera");
  refs.deviceButton = document.getElementById("button-devices");
  refs.compactControls = document.getElementById("compact-controls");
  refs.compactMicButton = document.getElementById("button-compact-mic");
  refs.compactSpeakerButton = document.getElementById("button-compact-speaker");
  refs.compactCameraButton = document.getElementById("button-compact-camera");
  refs.compactHangupButton = document.getElementById("button-compact-hangup");
  root.querySelectorAll("[data-action]").forEach((node) => {
    node.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const action = safeString(node.dataset.action);
      if (!action) {
        return;
      }
      try {
        switch (action) {
          case "accept":
            await acceptIncomingCall();
            return;
          case "reject":
            await rejectIncomingCall();
            return;
          case "hangup":
            await hangupCall();
            return;
          case "toggle-fullscreen":
            await requestToggleFullscreen();
            return;
          case "toggle-compact-mode":
          case "restore-regular-window":
            await requestToggleCompactMode(action);
            return;
          case "hide-window":
            await requestHideWindow();
            return;
          case "open-microphone-popover":
            await toggleMicrophone();
            return;
          case "open-speaker-popover":
            await toggleSpeaker();
            return;
          case "open-camera-popover":
            await toggleCamera();
            return;
          default:
            return;
        }
      } catch (error) {
        if (isPermissionError(error)) {
          emitPermissionDenied(error);
          return;
        }
        emitFatalError(error, "\u684C\u9762\u901A\u8BDD\u64CD\u4F5C\u5931\u8D25");
      }
    });
  });
  refs.devicePopoverToggle.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const deviceType = safeString(event.currentTarget.dataset.deviceType);
    if (!deviceType) {
      return;
    }
    try {
      if (deviceType === DEVICE_TYPE.microphone) {
        await toggleMicrophone();
      } else if (deviceType === DEVICE_TYPE.camera) {
        await toggleCamera();
      } else if (deviceType === DEVICE_TYPE.speaker) {
        await toggleSpeaker();
      }
    } catch (error) {
      if (isPermissionError(error)) {
        emitPermissionDenied(error);
        return;
      }
      emitFatalError(error, "\u8BBE\u5907\u72B6\u6001\u5207\u6362\u5931\u8D25");
    }
  });
  refs.devicePopoverList.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-device-id]");
    if (!item) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    await switchDevice(item.dataset.deviceType, item.dataset.deviceId);
  });
  const bindDevicePopoverHover = (node, deviceType) => {
    if (!node) {
      return;
    }
    node.addEventListener("mouseenter", () => {
      openDevicePopoverOnHover(deviceType);
    });
    node.addEventListener("mouseleave", () => {
      scheduleDevicePopoverClose(deviceType);
    });
    node.addEventListener("focusin", () => {
      openDevicePopoverOnHover(deviceType);
    });
    node.addEventListener("focusout", () => {
      scheduleDevicePopoverClose(deviceType);
    });
  };
  bindDevicePopoverHover(refs.micButton, DEVICE_TYPE.microphone);
  bindDevicePopoverHover(refs.deviceButton, DEVICE_TYPE.speaker);
  bindDevicePopoverHover(refs.cameraButton, DEVICE_TYPE.camera);
  bindDevicePopoverHover(refs.incomingCameraButton, DEVICE_TYPE.camera);
  const keepDevicePopoverOpen = () => {
    clearDevicePopoverCloseTimer();
  };
  const scheduleActiveDevicePopoverClose = () => {
    scheduleDevicePopoverClose();
  };
  refs.devicePopover.addEventListener("mouseenter", keepDevicePopoverOpen);
  refs.devicePopover.addEventListener("mouseleave", scheduleActiveDevicePopoverClose);
  refs.devicePopoverHoverBridge.addEventListener("mouseenter", keepDevicePopoverOpen);
  refs.devicePopoverHoverBridge.addEventListener("mouseleave", scheduleActiveDevicePopoverClose);
  refs.shell.addEventListener("click", (event) => {
    if (!state.activeDevicePopover) {
      return;
    }
    if (event.target.closest("#device-popover")) {
      return;
    }
    if (event.target.closest("[data-device-popover-trigger='true']")) {
      return;
    }
    clearDevicePopoverCloseTimer();
    state.activeDevicePopover = "";
    render();
  });
  refs.shell.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
  window.addEventListener("resize", () => {
    if (isCompactSizeMode() && state.activeDevicePopover) {
      state.activeDevicePopover = "";
    }
    if (state.activeDevicePopover && !refs.devicePopover?.hidden) {
      positionDevicePopover();
    }
    render();
  });
  render();
}
function normalizeDevice(device) {
  if (!device || typeof device !== "object") {
    return {
      deviceId: "",
      deviceName: ""
    };
  }
  return {
    deviceId: safeString(device.deviceId),
    deviceName: safeString(device.deviceName || device.label)
  };
}
function applyDeviceInventory(payload = {}) {
  if (Array.isArray(payload.cameraList)) {
    state.devices.cameraList = payload.cameraList.map(normalizeDevice);
  }
  if (Array.isArray(payload.microphoneList)) {
    state.devices.microphoneList = payload.microphoneList.map(normalizeDevice);
  }
  if (Array.isArray(payload.speakerList)) {
    state.devices.speakerList = payload.speakerList.map(normalizeDevice);
  }
  if (payload.currentCamera) {
    state.devices.currentCamera = safeString(payload.currentCamera.deviceId);
  } else if (!state.devices.currentCamera && state.devices.cameraList[0]) {
    state.devices.currentCamera = safeString(state.devices.cameraList[0].deviceId);
  }
  if (payload.currentMicrophone) {
    state.devices.currentMicrophone = safeString(payload.currentMicrophone.deviceId);
  } else if (!state.devices.currentMicrophone && state.devices.microphoneList[0]) {
    state.devices.currentMicrophone = safeString(state.devices.microphoneList[0].deviceId);
  }
  if (payload.currentSpeaker) {
    state.devices.currentSpeaker = safeString(payload.currentSpeaker.deviceId);
  } else if (!state.devices.currentSpeaker && state.devices.speakerList[0]) {
    state.devices.currentSpeaker = safeString(state.devices.speakerList[0].deviceId);
  }
}
async function refreshDeviceInventory({
  includeCamera = true,
  includeMicrophone = true,
  includeSpeaker = true
} = {}) {
  if (!state.engine) {
    return;
  }
  const [cameraList, microphoneList, speakerList] = await Promise.all([
    includeCamera ? state.engine.getDeviceList(DEVICE_TYPE.camera).catch(() => []) : Promise.resolve(null),
    includeMicrophone ? state.engine.getDeviceList(DEVICE_TYPE.microphone).catch(() => []) : Promise.resolve(null),
    includeSpeaker ? state.engine.getDeviceList(DEVICE_TYPE.speaker).catch(() => []) : Promise.resolve(null)
  ]);
  const payload = {};
  if (Array.isArray(cameraList)) {
    payload.cameraList = cameraList;
  }
  if (Array.isArray(microphoneList)) {
    payload.microphoneList = microphoneList;
  }
  if (Array.isArray(speakerList)) {
    payload.speakerList = speakerList;
  }
  if (Object.keys(payload).length == 0) {
    return;
  }
  applyDeviceInventory(payload);
  render();
}
function isCurrentUser(userId) {
  const normalizedUserId = safeString(userId);
  return normalizedUserId && normalizedUserId === safeString(state.bootstrapPayload?.userId);
}
async function refreshDeviceInventoryForType(deviceType) {
  if (!state.engine) {
    return;
  }
  const normalizedType = safeString(deviceType);
  if (!normalizedType) {
    return;
  }
  if (normalizedType === DEVICE_TYPE.camera && state.devices.cameraList.length === 0) {
    await refreshDeviceInventory({
      includeCamera: true,
      includeMicrophone: false,
      includeSpeaker: false
    });
    return;
  }
  if (normalizedType === DEVICE_TYPE.microphone && state.devices.microphoneList.length === 0) {
    await refreshDeviceInventory({
      includeCamera: false,
      includeMicrophone: true,
      includeSpeaker: false
    });
    return;
  }
  if (normalizedType === DEVICE_TYPE.speaker && state.devices.speakerList.length === 0) {
    await refreshDeviceInventory({
      includeCamera: false,
      includeMicrophone: false,
      includeSpeaker: true
    });
  }
}
async function switchDevice(deviceType, deviceId) {
  const normalizedDeviceId = safeString(deviceId);
  if (!state.engine || !normalizedDeviceId) {
    return;
  }
  try {
    await state.engine.switchDevice({
      deviceType,
      deviceId: normalizedDeviceId
    });
    if (deviceType === DEVICE_TYPE.camera) {
      state.devices.currentCamera = normalizedDeviceId;
    } else if (deviceType === DEVICE_TYPE.microphone) {
      state.devices.currentMicrophone = normalizedDeviceId;
    } else if (deviceType === DEVICE_TYPE.speaker) {
      state.devices.currentSpeaker = normalizedDeviceId;
    }
    render();
  } catch (error) {
    console.error("[DesktopCall] switchDevice failed", deviceType, error);
  }
}
function bindEngineEvent(eventName, handler) {
  if (!state.engine) {
    return;
  }
  diagLog("bind_engine_event", {
    eventName
  });
  const wrapped = async (payload = {}) => {
    diagLog("engine_event_received", {
      eventName,
      payload: summarizeDiagPayload(payload)
    });
    try {
      await handler(payload);
      diagLog("engine_event_handled", {
        eventName,
        phase: state.phase,
        connectionRole: state.connectionRole,
        activeRoomId: state.activeRoomId,
        activeCallId: state.activeCallId
      });
    } catch (error) {
      if (isPermissionError(error)) {
        emitPermissionDenied(error);
        return;
      }
      console.error("[DesktopCall] engine event failed", eventName, error);
    }
  };
  state.engine.on(eventName, wrapped);
  state.engineListeners.push({
    eventName,
    handler: wrapped
  });
}
function unbindEngineEvents() {
  if (!state.engine) {
    state.engineListeners = [];
    return;
  }
  state.engineListeners.forEach((item) => {
    try {
      state.engine.off(item.eventName, item.handler, void 0);
    } catch (_) {
    }
  });
  state.engineListeners = [];
}
function resetRuntimeState({ preserveBootstrap = false } = {}) {
  diagLog("reset_runtime_state", {
    preserveBootstrap,
    initialized: state.initialized,
    previousPhase: state.phase,
    previousConnectionRole: state.connectionRole,
    previousRoomId: state.activeRoomId,
    previousCallId: state.activeCallId
  });
  stopTickTimer();
  state.phase = CALL_PHASE.idle;
  state.connectionRole = "";
  state.activeRoomId = "";
  state.activeCallId = "";
  state.activeMediaType = CALL_MEDIA.audio;
  state.activeReason = "";
  state.activeMessage = "";
  state.lastUserData = {};
  state.caller = {
    id: "",
    name: "",
    avatar: ""
  };
  state.peer = {
    id: "",
    name: "",
    avatar: ""
  };
  state.remoteUserId = "";
  state.remoteVideoAttachedUserId = "";
  state.remoteVideoAvailable = false;
  state.remoteAudioAvailable = false;
  state.remoteVideoObserved = false;
  state.remoteAudioObserved = false;
  state.audioEnabled = false;
  state.videoEnabled = false;
  state.speakerEnabled = true;
  state.preferredAudioEnabled = true;
  state.preferredVideoEnabled = true;
  state.cameraPermissionDenied = false;
  state.microphonePermissionDenied = false;
  clearSessionNotice();
  state.autoplayResumeHint = "";
  state.activeDevicePopover = "";
  state.callStartedAt = 0;
  state.callConnectedAt = 0;
  state.elapsedLabel = "00:00";
  state.terminalBridgeKey = "";
  state.beginBridgeKey = "";
  state.lastFlutterStateSignature = "";
  state.networkHint = "";
  state.pendingLocalTerminalAction = "";
  setStatusText(
    preserveBootstrap && state.initialized ? "\u5DF2\u521D\u59CB\u5316\uFF0C\u7B49\u5F85\u6765\u7535\u6216\u53D1\u8D77\u547C\u53EB" : "\u6B63\u5728\u521D\u59CB\u5316\u684C\u9762\u901A\u8BDD..."
  );
}
async function destroyEngine({ preserveBootstrap = false } = {}) {
  diagLog("destroy_engine_start", {
    preserveBootstrap,
    hasEngine: Boolean(state.engine),
    initialized: state.initialized
  });
  clearTickTimer();
  pendingHostPermissionRequests.forEach((pending, requestId) => {
    window.clearTimeout(pending.timeoutId);
    pending.reject(new Error(`host permission request aborted: ${requestId}`));
  });
  pendingHostPermissionRequests.clear();
  if (state.engine) {
    unbindTRTCCloudEvents();
    unbindEngineEvents();
    try {
      await state.engine.destroyInstance();
    } catch (error) {
      console.warn("[DesktopCall] destroyInstance failed", error);
      try {
        await state.engine.logout();
      } catch (_) {
      }
    }
  }
  diagLog("destroy_engine_done", {
    preserveBootstrap
  });
  if (sharedIM) { await sharedIM.dispose(); sharedIM = undefined; }
  state.engine = null;
  state.initialized = preserveBootstrap && state.initialized;
  if (!preserveBootstrap) {
    state.bootstrapPayload = null;
    state.bootstrapSignature = "";
  }
  resetRuntimeState({ preserveBootstrap });
  render();
}
async function updateCallerFromIncoming(eventPayload) {
  const profile = await resolveIncomingCallerProfile(eventPayload);
  state.lastUserData = profile.userData;
  state.caller = {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar
  };
  state.peer = {
    id: state.caller.id,
    name: state.caller.name,
    avatar: state.caller.avatar
  };
}
function updatePeerFromOutgoingPayload(payload) {
  const calleeAccounts = Array.isArray(payload.calleeAccounts) ? payload.calleeAccounts : [];
  const firstPeerId = safeString(calleeAccounts[0]);
  state.peer = {
    id: firstPeerId,
    name: safeString(payload.calleeName),
    avatar: safeString(payload.calleeAvatar)
  };
  state.lastUserData = parseUserData(payload.userData);
}
function updateCallIdentity(payload = {}) {
  const roomId = resolveRoomId(payload);
  if (roomId) {
    state.activeRoomId = roomId;
  }
  const callId = safeString(payload.callId);
  if (callId) {
    state.activeCallId = callId;
  }
  const mediaType = resolveMediaType(payload.callMediaType ?? payload.mediaType);
  if (mediaType) {
    state.activeMediaType = mediaType;
  }
}
function mapNotConnectedType(payload) {
  const reason = safeNumber(payload.reason);
  if (reason === 2 || reason === 8) {
    return "user_reject";
  }
  if (reason === 3) {
    return "user_no_response";
  }
  if (reason === 5) {
    return "user_line_busy";
  }
  return "not_connected";
}
function markConnected(payload = {}, source = "") {
  updateCallIdentity(payload);
  const callKey = resolveCallSessionKey(payload);
  state.phase = CALL_PHASE.connected;
  state.connectionRole = state.connectionRole || "connected";
  if (!state.callStartedAt) {
    state.callStartedAt = Date.now();
  }
  if (!state.callConnectedAt) {
    state.callConnectedAt = Date.now();
    ensureTickTimer();
  }
  setStatusText(source === "user_accept" ? "\u5BF9\u65B9\u5DF2\u63A5\u542C" : "\u5DF2\u63A5\u901A");
  render();
  if (state.beginBridgeKey !== callKey) {
    state.beginBridgeKey = callKey;
    postToFlutter("begin", {
      roomId: state.activeRoomId,
      callId: state.activeCallId,
      mediaType: state.activeMediaType,
      userData: state.lastUserData,
      callerName: state.caller.name,
      callerAvatar: state.caller.avatar
    });
  }
}
function isTerminalAlreadyEmitted(payload = {}) {
  const callKey = resolveCallSessionKey(payload);
  return callKey && state.terminalBridgeKey === callKey;
}
function markTerminalEmitted(payload = {}) {
  state.terminalBridgeKey = resolveCallSessionKey(payload);
}
async function finalizeTerminalState(type, payload = {}, statusText) {
  diagLog("finalize_terminal_state_start", {
    type,
    payload: summarizeDiagPayload(payload),
    statusText,
    pendingLocalTerminalAction: state.pendingLocalTerminalAction,
    terminalBridgeKey: state.terminalBridgeKey,
    sessionKey: resolveCallSessionKey(payload)
  });
  updateCallIdentity(payload);
  if (isTerminalAlreadyEmitted(payload)) {
    diagLog("finalize_terminal_state_duplicate_skip", {
      type,
      payload: summarizeDiagPayload(payload),
      terminalBridgeKey: state.terminalBridgeKey,
      sessionKey: resolveCallSessionKey(payload)
    });
    return;
  }
  markTerminalEmitted(payload);
  const localTerminalAction = state.pendingLocalTerminalAction;
  state.pendingLocalTerminalAction = "";
  let resolvedStatusText = statusText;
  if (type === "user_reject") {
    resolvedStatusText = localTerminalAction === "reject" ? "\u5DF2\u62D2\u7EDD" : "\u5BF9\u65B9\u5DF2\u62D2\u7EDD";
  } else if (type === "end") {
    resolvedStatusText = localTerminalAction === "hangup" ? "\u901A\u8BDD\u5DF2\u7ED3\u675F" : "\u5BF9\u65B9\u5DF2\u6302\u65AD";
  }
  state.phase = CALL_PHASE.ending;
  setStatusText(resolvedStatusText);
  render();
  postToFlutter(type, {
    roomId: state.activeRoomId,
    callId: state.activeCallId,
    mediaType: state.activeMediaType,
    userData: state.lastUserData,
    callerName: state.caller.name,
    callerAvatar: state.caller.avatar,
    reason: safeString(payload.reason),
    message: resolvedStatusText
  });
  await cleanupActiveMedia();
  resetRuntimeState({ preserveBootstrap: true });
  render();
  diagLog("finalize_terminal_state_done", {
    type,
    resolvedStatusText,
    phase: state.phase,
    terminalBridgeKey: state.terminalBridgeKey
  });
}
async function attachRemoteView(userId) {
  const normalizedUserId = safeString(userId);
  if (!state.engine || !normalizedUserId || state.activeMediaType !== CALL_MEDIA.video || state.phase !== CALL_PHASE.connected) {
    return;
  }
  if (state.remoteVideoAttachedUserId === normalizedUserId) {
    return;
  }
  await state.engine.startRemoteView({
    userID: normalizedUserId,
    videoViewDomID: REMOTE_VIDEO_ID,
    options: {
      fillMode: "contain"
    }
  });
  state.remoteVideoAttachedUserId = normalizedUserId;
  state.remoteVideoAvailable = true;
  state.remoteVideoObserved = true;
  render();
  window.setTimeout(syncSpeakerOutputState, 0);
  window.setTimeout(syncSpeakerOutputState, 260);
}
async function stopRemoteView() {
  if (!state.engine || !state.remoteVideoAttachedUserId) {
    return;
  }
  try {
    await state.engine.stopRemoteView({
      userID: state.remoteVideoAttachedUserId
    });
  } catch (_) {
  }
  state.remoteVideoAttachedUserId = "";
  state.remoteVideoAvailable = false;
  render();
}
async function cleanupActiveMedia() {
  if (!state.engine) {
    state.remoteVideoAttachedUserId = "";
    state.remoteVideoAvailable = false;
    state.remoteVideoObserved = false;
    state.remoteAudioAvailable = false;
    state.remoteAudioObserved = false;
    state.audioEnabled = false;
    state.videoEnabled = false;
    return;
  }
  if (state.remoteVideoAttachedUserId) {
    await stopRemoteView();
  }
  if (state.videoEnabled) {
    try {
      await state.engine.closeCamera();
    } catch (_) {
    }
  }
  if (state.audioEnabled) {
    try {
      await state.engine.closeMicrophone();
    } catch (_) {
    }
  }
  state.audioEnabled = false;
  state.videoEnabled = false;
  state.remoteVideoAttachedUserId = "";
  state.remoteVideoAvailable = false;
  state.remoteVideoObserved = false;
  state.remoteAudioAvailable = false;
  state.remoteAudioObserved = false;
}
function applyPermissionSnapshot(permissionResult = {}) {
  if (permissionResult.cameraRequested) {
    state.cameraPermissionDenied = permissionResult.cameraGranted !== true;
  }
  if (permissionResult.microphoneRequested) {
    state.microphonePermissionDenied = permissionResult.microphoneGranted !== true;
  }
}
function getPermissionErrorMessage(permissionResult = {}, fallbackMessage) {
  if (permissionResult.microphoneRequested && permissionResult.microphoneGranted !== true) {
    return permissionResult.message || fallbackMessage || "\u7F3A\u5C11\u9EA6\u514B\u98CE\u6743\u9650";
  }
  if (permissionResult.cameraRequested && permissionResult.cameraGranted !== true) {
    return permissionResult.message || fallbackMessage || "\u7F3A\u5C11\u6444\u50CF\u5934\u6743\u9650";
  }
  return permissionResult.message || fallbackMessage || "\u7F3A\u5C11\u9EA6\u514B\u98CE\u6216\u76F8\u673A\u6743\u9650";
}
function shouldAttemptLocalCamera() {
  return state.activeMediaType === CALL_MEDIA.video && state.preferredVideoEnabled && !state.cameraPermissionDenied;
}
function shouldAttemptLocalMicrophone() {
  return state.preferredAudioEnabled;
}
async function ensureLocalMediaActive({
  withCamera,
  withMicrophone,
  reason,
  allowCameraFailure = false,
  noticeOnCameraFailure = "",
  permissionResult: initialPermissionResult = null,
  expectedSessionKey = ""
}) {
  const needsCamera = Boolean(withCamera && !state.videoEnabled);
  const needsMicrophone = Boolean(withMicrophone && !state.audioEnabled);
  diagLog(
    "ensure_local_media_active_start",
    captureRuntimeSnapshot({
      reason,
      withCamera: withCamera === true,
      withMicrophone: withMicrophone === true,
      allowCameraFailure,
      expectedSessionKey,
      needsCamera,
      needsMicrophone
    })
  );
  const permissionResult = initialPermissionResult || (needsCamera || needsMicrophone ? await requestHostMediaPermissions({
    camera: needsCamera,
    microphone: needsMicrophone,
    reason
  }) : null);
  if (permissionResult) {
    applyPermissionSnapshot(permissionResult);
    diagLog(
      "ensure_local_media_active_permissions",
      captureRuntimeSnapshot({
        reason,
        needsCamera,
        needsMicrophone,
        cameraRequested: permissionResult.cameraRequested === true,
        microphoneRequested: permissionResult.microphoneRequested === true,
        cameraGranted: permissionResult.cameraGranted !== false,
        microphoneGranted: permissionResult.microphoneGranted !== false,
        cameraStatus: safeString(permissionResult.cameraStatus),
        microphoneStatus: safeString(permissionResult.microphoneStatus),
        granted: permissionResult.granted === true
      })
    );
  }
  const microphoneGranted = !needsMicrophone || permissionResult?.microphoneGranted !== false;
  const cameraGranted = !needsCamera || permissionResult?.cameraGranted !== false;
  if (!microphoneGranted) {
    throw new Error(getPermissionErrorMessage(permissionResult, "\u7F3A\u5C11\u9EA6\u514B\u98CE\u6743\u9650"));
  }
  if (needsCamera && !cameraGranted && !allowCameraFailure) {
    throw new Error(getPermissionErrorMessage(permissionResult, "\u7F3A\u5C11\u6444\u50CF\u5934\u6743\u9650"));
  }
  if (!state.engine) {
    diagLog(
      "ensure_local_media_active_skip_no_engine",
      captureRuntimeSnapshot({
        reason,
        needsCamera,
        needsMicrophone
      })
    );
    render();
    return {
      microphoneGranted,
      cameraGranted,
      degradedToAudio: needsCamera && !cameraGranted,
      aborted: false
    };
  }
  if (isExpectedSessionStale(expectedSessionKey)) {
    diagLog(
      "ensure_local_media_active_aborted_stale_session",
      buildExpectedSessionSnapshot(reason, expectedSessionKey)
    );
    return {
      microphoneGranted,
      cameraGranted,
      degradedToAudio: needsCamera && !cameraGranted,
      aborted: true
    };
  }
  if (needsMicrophone) {
    diagLog(
      "ensure_local_media_active_open_microphone_start",
      captureRuntimeSnapshot({
        reason
      })
    );
    try {
      await state.engine.openMicrophone();
      if (isExpectedSessionStale(expectedSessionKey)) {
        try {
          await state.engine.closeMicrophone();
        } catch (_) {
        }
        state.audioEnabled = false;
        diagLog(
          "ensure_local_media_active_aborted_after_open_microphone",
          buildExpectedSessionSnapshot(reason, expectedSessionKey)
        );
        return {
          microphoneGranted,
          cameraGranted,
          degradedToAudio: needsCamera && !cameraGranted,
          aborted: true
        };
      }
      state.audioEnabled = true;
      render();
      diagLog(
        "ensure_local_media_active_open_microphone_success",
        captureRuntimeSnapshot({
          reason
        })
      );
    } catch (error) {
      diagLog(
        "ensure_local_media_active_open_microphone_failed",
        captureRuntimeSnapshot({
          reason,
          error: trimDiagText(error?.message || error)
        })
      );
      throw error;
    }
  }
  if (needsCamera && cameraGranted) {
    state.videoEnabled = true;
    render();
    diagLog(
      "ensure_local_media_active_open_camera_start",
      captureRuntimeSnapshot({
        reason
      })
    );
    try {
      await state.engine.openCamera(LOCAL_VIDEO_ID);
      if (isExpectedSessionStale(expectedSessionKey)) {
        try {
          await state.engine.closeCamera();
        } catch (_) {
        }
        state.videoEnabled = false;
        render();
        diagLog(
          "ensure_local_media_active_aborted_after_open_camera",
          buildExpectedSessionSnapshot(reason, expectedSessionKey)
        );
        return {
          microphoneGranted,
          cameraGranted,
          degradedToAudio: needsCamera && !cameraGranted,
          aborted: true
        };
      }
      clearSessionNotice();
      emitStateSnapshot("camera_open_success", { force: true });
      diagLog(
        "ensure_local_media_active_open_camera_success",
        captureRuntimeSnapshot({
          reason
        })
      );
    } catch (error) {
      state.videoEnabled = false;
      render();
      emitStateSnapshot("camera_open_failed", { force: true });
      diagLog(
        "ensure_local_media_active_open_camera_failed",
        captureRuntimeSnapshot({
          reason,
          error: trimDiagText(error?.message || error)
        })
      );
      throw error;
    }
  }
  if (needsCamera && !cameraGranted) {
    state.videoEnabled = false;
    if (noticeOnCameraFailure) {
      setSessionNotice(noticeOnCameraFailure);
    }
  }
  render();
  diagLog(
    "ensure_local_media_active_done",
    captureRuntimeSnapshot({
      reason,
      degradedToAudio: needsCamera && !cameraGranted
    })
  );
  return {
    microphoneGranted,
    cameraGranted,
    degradedToAudio: needsCamera && !cameraGranted,
    aborted: false
  };
}
async function prepareIncomingVideoPreview(expectedSessionKey = "") {
  if (!state.engine || state.phase !== CALL_PHASE.incoming || state.activeMediaType !== CALL_MEDIA.video || state.preferredVideoEnabled !== true) {
    return;
  }
  try {
    const mediaResult = await ensureLocalMediaActive({
      withCamera: true,
      withMicrophone: false,
      reason: "incoming_auto_camera_preview",
      allowCameraFailure: true,
      noticeOnCameraFailure: "\u672A\u83B7\u5F97\u6444\u50CF\u5934\u6743\u9650\uFF0C\u5C06\u4EE5\u8BED\u97F3\u65B9\u5F0F\u63A5\u542C",
      expectedSessionKey
    });
    if (mediaResult.aborted) {
      return;
    }
    state.preferredVideoEnabled = mediaResult.cameraGranted === true;
    render();
  } catch (error) {
    console.warn("[DesktopCall] incoming video preview failed", error);
    if (expectedSessionKey && resolveCallSessionKey() && resolveCallSessionKey() !== expectedSessionKey) {
      return;
    }
    state.preferredVideoEnabled = false;
    setSessionNotice("\u672A\u83B7\u5F97\u6444\u50CF\u5934\u6743\u9650\uFF0C\u5C06\u4EE5\u8BED\u97F3\u65B9\u5F0F\u63A5\u542C");
    render();
  }
}
async function toggleMicrophone() {
  if (!state.engine || state.phase === CALL_PHASE.idle) {
    return;
  }
  diagLog(
    "toggle_microphone_start",
    captureRuntimeSnapshot({
      reason: "toggle_microphone"
    })
  );
  if (state.phase === CALL_PHASE.incoming) {
    state.preferredAudioEnabled = !state.preferredAudioEnabled;
    render();
    diagLog(
      "toggle_microphone_done",
      captureRuntimeSnapshot({
        reason: "toggle_microphone",
        incomingOnly: true
      })
    );
    return;
  }
  if (state.audioEnabled) {
    await state.engine.closeMicrophone();
    state.audioEnabled = false;
    state.preferredAudioEnabled = false;
  } else {
    await ensureLocalMediaActive({
      withCamera: false,
      withMicrophone: true,
      reason: "toggle_microphone"
    });
    state.preferredAudioEnabled = true;
  }
  render();
  diagLog(
    "toggle_microphone_done",
    captureRuntimeSnapshot({
      reason: "toggle_microphone"
    })
  );
}
async function toggleCamera() {
  if (!state.engine || state.activeMediaType !== CALL_MEDIA.video) {
    return;
  }
  diagLog(
    "toggle_camera_start",
    captureRuntimeSnapshot({
      reason: "toggle_camera"
    })
  );
  if (state.phase === CALL_PHASE.incoming) {
    if (state.videoEnabled) {
      await state.engine.closeCamera();
      state.videoEnabled = false;
      state.preferredVideoEnabled = false;
      render();
      diagLog(
        "toggle_camera_done",
        captureRuntimeSnapshot({
          reason: "toggle_camera",
          incomingOnly: true
        })
      );
      return;
    }
    const mediaResult2 = await ensureLocalMediaActive({
      withCamera: true,
      withMicrophone: false,
      reason: "incoming_camera_preview",
      allowCameraFailure: true,
      noticeOnCameraFailure: "\u672A\u83B7\u5F97\u6444\u50CF\u5934\u6743\u9650\uFF0C\u5C06\u4EE5\u8BED\u97F3\u65B9\u5F0F\u63A5\u542C"
    });
    state.preferredVideoEnabled = mediaResult2.cameraGranted === true;
    diagLog(
      "toggle_camera_done",
      captureRuntimeSnapshot({
        reason: "toggle_camera",
        incomingOnly: true,
        cameraGranted: mediaResult2.cameraGranted === true
      })
    );
    return;
  }
  if (state.phase !== CALL_PHASE.outgoing && state.phase !== CALL_PHASE.connected) {
    return;
  }
  if (state.videoEnabled) {
    await state.engine.closeCamera();
    state.videoEnabled = false;
    state.preferredVideoEnabled = false;
    render();
    return;
  }
  const mediaResult = await ensureLocalMediaActive({
    withCamera: true,
    withMicrophone: false,
    reason: "toggle_camera",
    allowCameraFailure: true,
    noticeOnCameraFailure: "\u672A\u83B7\u5F97\u6444\u50CF\u5934\u6743\u9650\uFF0C\u65E0\u6CD5\u5F00\u542F\u672C\u5730\u89C6\u9891"
  });
  state.preferredVideoEnabled = mediaResult.cameraGranted === true;
  diagLog(
    "toggle_camera_done",
    captureRuntimeSnapshot({
      reason: "toggle_camera",
      cameraGranted: mediaResult.cameraGranted === true
    })
  );
}
async function toggleSpeaker() {
  state.speakerEnabled = !state.speakerEnabled;
  if (!state.speakerEnabled) {
    clearAutoplayResumeHint("speaker_disabled");
  }
  syncSpeakerOutputState();
  await syncSpeakerOutputStateToEngine();
  render();
}
async function rejectIncomingCall() {
  if (!state.engine) {
    return;
  }
  state.pendingLocalTerminalAction = "reject";
  try {
    await state.engine.reject();
  } catch (error) {
    state.pendingLocalTerminalAction = "";
    throw error;
  }
}
async function acceptIncomingCall() {
  if (!state.engine) {
    return;
  }
  const withCamera = state.activeMediaType === CALL_MEDIA.video && state.preferredVideoEnabled === true;
  const withMicrophone = state.preferredAudioEnabled === true;
  const mediaResult = await ensureLocalMediaActive({
    withCamera,
    withMicrophone,
    reason: "accept_call",
    allowCameraFailure: withCamera,
    noticeOnCameraFailure: "\u672A\u83B7\u5F97\u6444\u50CF\u5934\u6743\u9650\uFF0C\u5DF2\u5207\u6362\u4E3A\u8BED\u97F3\u63A5\u542C"
  });
  state.preferredAudioEnabled = withMicrophone;
  state.preferredVideoEnabled = withCamera ? mediaResult.cameraGranted === true : false;
  state.activeDevicePopover = "";
  await state.engine.accept();
}
async function hangupCall() {
  if (!state.engine) {
    return;
  }
  const engine = state.engine;
  state.pendingLocalTerminalAction = "hangup";
  diagLog("hangup_call_start", captureRuntimeSnapshot({
    pendingLocalTerminalAction: state.pendingLocalTerminalAction
  }));
  postLocalTerminalToWebHost("end", "\u901A\u8BDD\u5DF2\u7ED3\u675F");
  void engine.hangup().catch(() => {
    state.pendingLocalTerminalAction = "";
    diagLog("hangup_call_engine_failed", captureRuntimeSnapshot());
  });
  await finalizeTerminalState("end", {}, "\u901A\u8BDD\u5DF2\u7ED3\u675F");
  diagLog("hangup_call_done", captureRuntimeSnapshot());
}
async function requestToggleFullscreen() {
  state.activeDevicePopover = "";
  render();
  const posted = postToFlutter("toggle_fullscreen_request", {
    reason: "toolbar_fullscreen_button"
  });
  if (!posted) {
    throw new Error("\u684C\u9762\u901A\u8BDD\u7A97\u53E3\u5168\u5C4F\u5207\u6362\u8BF7\u6C42\u53D1\u9001\u5931\u8D25");
  }
}
async function requestToggleCompactMode(source = "") {
  state.activeDevicePopover = "";
  render();
  const reason = source === "restore-regular-window" ? "compact_restore_button" : "toolbar_compact_button";
  const posted = postToFlutter("toggle_compact_mode_request", {
    reason
  });
  if (!posted) {
    throw new Error("\u684C\u9762\u901A\u8BDD\u7A97\u53E3\u5C3A\u5BF8\u5207\u6362\u8BF7\u6C42\u53D1\u9001\u5931\u8D25");
  }
}
async function requestHideWindow() {
  const posted = postToFlutter("hide_window_request", {
    reason: "toolbar_hide_button"
  });
  if (!posted) {
    throw new Error("\u684C\u9762\u901A\u8BDD\u7A97\u53E3\u9690\u85CF\u8BF7\u6C42\u53D1\u9001\u5931\u8D25");
  }
}
async function bootstrap(payload = {}) {
  diagLog("bootstrap_start", {
    payload: summarizeDiagPayload(payload),
    sdkAppId: safeNumber(payload.sdkAppId),
    userId: safeString(payload.userId)
  });
  const signature = [
    safeString(payload.sdkAppId),
    safeString(payload.userId),
    safeString(payload.userSig),
    safeString(payload.nickName),
    safeString(payload.avatar)
  ].join("|");
  if (state.initialized && state.bootstrapSignature === signature && state.engine) {
    await configureTRTCAutoplayHandling();
    diagLog("bootstrap_reuse_existing_engine", {
      userId: safeString(payload.userId),
      reused: true
    });
    setStatusText("\u5DF2\u521D\u59CB\u5316\uFF0C\u7B49\u5F85\u6765\u7535\u6216\u53D1\u8D77\u547C\u53EB");
    render();
    postToFlutter("ready");
    return;
  }
  await destroyEngine();
  resetRuntimeState();
  render();
  const callEngineExport = resolveCallEngineExport();
  diagLog("bootstrap_engine_export_resolved", {
    source: callEngineExport.source,
    type: typeof callEngineExport.value
  });
  await waitForCallEngineReady(callEngineExport);
  sharedIM = createIMBridge(TencentChat, safeNumber(payload.sdkAppId), safeString(payload.userId), postToFlutter);
  const engine = callEngineExport.value.createInstance({
    SDKAppID: safeNumber(payload.sdkAppId), tim: sharedIM.chat
  });
  diagLog("bootstrap_engine_created", {
    engineExportSource: callEngineExport.source,
    userId: safeString(payload.userId),
    sdkAppId: safeNumber(payload.sdkAppId),
    hasOn: typeof engine?.on === "function",
    hasOff: typeof engine?.off === "function",
    hasLogin: typeof engine?.login === "function",
    hasCalls: typeof engine?.calls === "function",
    eventConstants: {
      ON_CALL_RECEIVED: safeString(import_call_engine_lite_js.TUICallEvent.ON_CALL_RECEIVED),
      USER_ACCEPT: safeString(import_call_engine_lite_js.TUICallEvent.USER_ACCEPT),
      USER_ENTER: safeString(import_call_engine_lite_js.TUICallEvent.USER_ENTER),
      ON_CALL_BEGIN: safeString(import_call_engine_lite_js.TUICallEvent.ON_CALL_BEGIN),
      ON_CALL_END: safeString(import_call_engine_lite_js.TUICallEvent.ON_CALL_END),
      ON_CALL_NOT_CONNECTED: safeString(import_call_engine_lite_js.TUICallEvent.ON_CALL_NOT_CONNECTED),
      ERROR: safeString(import_call_engine_lite_js.TUICallEvent.ERROR)
    }
  });
  state.engine = engine;
  state.bootstrapPayload = payload;
  state.bootstrapSignature = signature;
  if (payload.outgoingOnly !== true) {
    bindEngineEvent(import_call_engine_lite_js.TUICallEvent.ON_CALL_RECEIVED, async (eventPayload) => {
    diagLog("incoming_event_handler_enter", {
      payload: summarizeDiagPayload(eventPayload)
    });
    updateCallIdentity(eventPayload);
    if (state.phase === CALL_PHASE.outgoing || state.phase === CALL_PHASE.connected) {
      const incomingCallerProfile = await resolveIncomingCallerProfile(eventPayload);
      diagLog("incoming_event_forward_existing_session", {
        payload: summarizeDiagPayload(eventPayload),
        callerId: incomingCallerProfile.id,
        callerName: incomingCallerProfile.name
      });
      postToFlutter("incoming", {
        roomId: resolveRoomId(eventPayload),
        callId: safeString(eventPayload.callId),
        mediaType: resolveMediaType(eventPayload.callMediaType),
        userData: incomingCallerProfile.userData,
        callerName: incomingCallerProfile.name,
        callerAvatar: incomingCallerProfile.avatar
      });
      return;
    }
    state.connectionRole = "incoming";
    state.phase = CALL_PHASE.incoming;
    state.callStartedAt = Date.now();
    state.activeDevicePopover = "";
    state.remoteVideoObserved = false;
    state.remoteAudioObserved = false;
    state.remoteVideoAvailable = false;
    state.remoteAudioAvailable = false;
    state.preferredAudioEnabled = true;
    state.preferredVideoEnabled = state.activeMediaType === CALL_MEDIA.video;
    state.cameraPermissionDenied = false;
    state.microphonePermissionDenied = false;
    clearSessionNotice();
    await updateCallerFromIncoming(eventPayload);
    setStatusText("\u6536\u5230\u65B0\u7684\u6765\u7535\u9080\u8BF7");
    render();
    diagLog("incoming_event_emit_flutter", {
      payload: summarizeDiagPayload(eventPayload),
      callerName: state.caller.name,
      callerAvatar: trimDiagText(state.caller.avatar)
    });
    postToFlutter("incoming", {
      roomId: resolveRoomId(eventPayload),
      callId: safeString(eventPayload.callId),
      mediaType: resolveMediaType(eventPayload.callMediaType),
      userData: state.lastUserData,
      callerName: state.caller.name,
      callerAvatar: state.caller.avatar
    });
    if (state.activeMediaType === CALL_MEDIA.video) {
      const incomingSessionKey = resolveCallSessionKey(eventPayload);
      void prepareIncomingVideoPreview(incomingSessionKey);
    }
    });
  }
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.USER_ACCEPT, async (eventPayload) => {
    const acceptedUserId = safeString(eventPayload.userID);
    if (acceptedUserId) {
      state.remoteUserId = acceptedUserId;
      if (!state.peer.id || state.connectionRole === "outgoing") {
        state.peer.id = acceptedUserId;
      }
    }
    if (state.connectionRole === "outgoing") {
      markConnected(eventPayload, "user_accept");
      await ensureLocalMediaActive({
        withCamera: shouldAttemptLocalCamera(),
        withMicrophone: shouldAttemptLocalMicrophone(),
        reason: "caller_connected"
      });
    }
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.USER_ENTER, async (eventPayload) => {
    const joinedUserId = safeString(eventPayload.userID);
    if (joinedUserId && joinedUserId !== safeString(payload.userId)) {
      state.remoteUserId = joinedUserId;
      if (!state.peer.id || state.connectionRole === "outgoing") {
        state.peer.id = joinedUserId;
      }
    }
    if (state.phase !== CALL_PHASE.connected) {
      markConnected(eventPayload, "user_enter");
    }
    if (state.activeMediaType === CALL_MEDIA.video && state.remoteVideoAvailable) {
      await attachRemoteView(state.remoteUserId || joinedUserId);
    }
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.USER_VIDEO_AVAILABLE, async (eventPayload) => {
    const userId = safeString(eventPayload.userID);
    const isVideoAvailable = eventPayload.isVideoAvailable === true;
    const isSelfUser = isCurrentUser(userId);
    diagLog(
      isSelfUser ? "self_video_available_event" : "remote_video_available_event",
      captureRuntimeSnapshot({
        eventUserId: userId,
        isVideoAvailable
      })
    );
    if (isSelfUser) {
      state.videoEnabled = isVideoAvailable;
      render();
      return;
    }
    if (userId) {
      state.remoteUserId = userId;
    }
    state.remoteVideoObserved = true;
    state.remoteVideoAvailable = isVideoAvailable;
    if (isVideoAvailable) {
      await attachRemoteView(userId);
    } else {
      await stopRemoteView();
    }
    render();
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.USER_AUDIO_AVAILABLE, async (eventPayload) => {
    const userId = safeString(eventPayload.userID);
    const isSelfUser = isCurrentUser(userId);
    diagLog(
      isSelfUser ? "self_audio_available_event" : "remote_audio_available_event",
      captureRuntimeSnapshot({
        eventUserId: userId,
        isAudioAvailable: eventPayload.isAudioAvailable === true
      })
    );
    if (isSelfUser) {
      state.audioEnabled = eventPayload.isAudioAvailable === true;
      render();
      return;
    }
    if (userId) {
      state.remoteUserId = userId;
    }
    state.remoteAudioObserved = true;
    state.remoteAudioAvailable = eventPayload.isAudioAvailable === true;
    syncSpeakerOutputState();
    await syncSpeakerOutputStateToEngine();
    render();
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.USER_VOICE_VOLUME, async (eventPayload) => {
    const volumes = Array.isArray(eventPayload.volumeMap) ? eventPayload.volumeMap : Array.isArray(eventPayload.userVolumes) ? eventPayload.userVolumes : Array.isArray(eventPayload.volumeArray) ? eventPayload.volumeArray : Array.isArray(eventPayload.result) ? eventPayload.result : [];
    const selfEntry = volumes.find((item) => isCurrentUser(item?.userID || item?.userId));
    const remoteEntries = volumes.filter((item) => !isCurrentUser(item?.userID || item?.userId)).map((item) => ({
      userId: safeString(item?.userID || item?.userId),
      volume: safeNumber(item?.volume)
    })).filter((item) => item.userId || item.volume > 0);
    diagLog(
      "user_voice_volume_event",
      captureRuntimeSnapshot({
        selfVolume: safeNumber(selfEntry?.volume),
        remoteVolumes: remoteEntries,
        rawCount: volumes.length
      })
    );
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.ON_CALL_BEGIN, async (eventPayload) => {
    markConnected(eventPayload, "on_call_begin");
    await ensureLocalMediaActive({
      withCamera: shouldAttemptLocalCamera(),
      withMicrophone: shouldAttemptLocalMicrophone(),
      reason: "call_begin"
    });
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.ON_CALL_END, async (eventPayload) => {
    await finalizeTerminalState("end", eventPayload, "\u901A\u8BDD\u5DF2\u7ED3\u675F");
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.REJECT, async (eventPayload) => {
    await finalizeTerminalState("user_reject", eventPayload, "\u5BF9\u65B9\u5DF2\u62D2\u7EDD");
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.NO_RESP, async (eventPayload) => {
    await finalizeTerminalState("user_no_response", eventPayload, "\u5BF9\u65B9\u65E0\u5E94\u7B54");
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.LINE_BUSY, async (eventPayload) => {
    await finalizeTerminalState("user_line_busy", eventPayload, "\u5BF9\u65B9\u5FD9\u7EBF\u4E2D");
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.ON_CALL_NOT_CONNECTED, async (eventPayload) => {
    const bridgeType = mapNotConnectedType(eventPayload);
    const statusMap = {
      not_connected: "\u901A\u8BDD\u672A\u63A5\u901A",
      user_reject: "\u5BF9\u65B9\u5DF2\u62D2\u7EDD",
      user_no_response: "\u5BF9\u65B9\u65E0\u5E94\u7B54",
      user_line_busy: "\u5BF9\u65B9\u5FD9\u7EBF\u4E2D"
    };
    await finalizeTerminalState(bridgeType, eventPayload, statusMap[bridgeType] || "\u901A\u8BDD\u672A\u63A5\u901A");
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.DEVICED_UPDATED, async (eventPayload) => {
    applyDeviceInventory(eventPayload);
    render();
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.ON_USER_NETWORK_QUALITY_CHANGED, async (eventPayload) => {
    const network = Array.isArray(eventPayload.network) ? eventPayload.network : Array.isArray(eventPayload.networkQualityList) ? eventPayload.networkQualityList : [];
    const weak = network.find((item) => safeNumber(item.quality) >= 4);
    state.networkHint = weak ? "\u5F53\u524D\u901A\u8BDD\u7F51\u7EDC\u8F83\u5DEE" : "";
    render();
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.KICKED_OUT, async () => {
    postToFlutter("im_kicked", { reason: "kicked_out" });
    diagLog("engine_kicked_out", {
      userId: safeString(payload.userId)
    });
    emitFatalError(new Error("\u5F53\u524D\u767B\u5F55\u5DF2\u5728\u5176\u4ED6\u8BBE\u5907\u63A5\u7BA1\uFF0C\u684C\u9762\u901A\u8BDD\u5DF2\u9000\u51FA"));
  });
  bindEngineEvent(import_call_engine_lite_js.TUICallEvent.ERROR, async (eventPayload) => {
    diagLog("engine_error_event", {
      payload: summarizeDiagPayload(eventPayload)
    });
    console.error("[DesktopCall] engine error", eventPayload);
  });
  diagLog("bootstrap_login_start", {
    userId: safeString(payload.userId)
  });
  await engine.login({
    userID: safeString(payload.userId),
    userSig: safeString(payload.userSig)
  });
  diagLog("bootstrap_login_success", {
    userId: safeString(payload.userId)
  });
  await configureTRTCAutoplayHandling();
  if (safeString(payload.nickName) || safeString(payload.avatar)) {
    try {
      await engine.setSelfInfo({
        nickName: safeString(payload.nickName),
        avatar: safeString(payload.avatar)
      });
    } catch (error) {
      diagLog("bootstrap_set_self_info_failed", {
        userId: safeString(payload.userId),
        error: trimDiagText(error?.message || error)
      });
      console.warn("[DesktopCall] setSelfInfo failed", error);
    }
  }
  state.initialized = true;
  resetRuntimeState({ preserveBootstrap: true });
  diagLog("bootstrap_skip_device_inventory_preload", {
    userId: safeString(payload.userId)
  });
  diagLog("bootstrap_ready", {
    userId: safeString(payload.userId),
    devices: {
      cameraCount: state.devices.cameraList.length,
      microphoneCount: state.devices.microphoneList.length,
      speakerCount: state.devices.speakerList.length
    }
  });
  render();
  postToFlutter("ready");
}
async function startOutgoingCall(payload = {}) {
  if (!state.engine) {
    throw new Error("\u684C\u9762\u901A\u8BDD\u5F15\u64CE\u5C1A\u672A\u521D\u59CB\u5316");
  }
  const mediaType = resolveMediaType(payload.mediaType);
  state.connectionRole = "outgoing";
  state.phase = CALL_PHASE.outgoing;
  state.activeRoomId = safeString(payload.roomId);
  state.activeCallId = "";
  state.activeMediaType = mediaType;
  state.callStartedAt = 0;
  state.callConnectedAt = 0;
  state.beginBridgeKey = "";
  state.terminalBridgeKey = "";
  state.activeDevicePopover = "";
  state.remoteVideoAvailable = false;
  state.remoteAudioAvailable = false;
  state.remoteVideoObserved = false;
  state.remoteAudioObserved = false;
  state.speakerEnabled = true;
  state.preferredAudioEnabled = true;
  state.preferredVideoEnabled = mediaType === CALL_MEDIA.video;
  state.cameraPermissionDenied = false;
  state.microphonePermissionDenied = false;
  clearSessionNotice();
  updatePeerFromOutgoingPayload(payload);
  setStatusText("\u6B63\u5728\u68C0\u67E5\u901A\u8BDD\u6743\u9650...");
  render();
  const expectedSessionKey = safeString(payload.roomId) || resolveCallSessionKey(payload);
  const permissionResult = await requestHostMediaPermissions({
    camera: mediaType === CALL_MEDIA.video,
    microphone: true,
    reason: "outgoing_call"
  });
  applyPermissionSnapshot(permissionResult);
  if (permissionResult.microphoneGranted !== true) {
    throw new Error(getPermissionErrorMessage(permissionResult));
  }
  if (mediaType === CALL_MEDIA.video && permissionResult.cameraGranted !== true) {
    state.preferredVideoEnabled = false;
    state.videoEnabled = false;
    setSessionNotice("\u672A\u83B7\u5F97\u6444\u50CF\u5934\u6743\u9650\uFF0C\u5C06\u4EE5\u8BED\u97F3\u65B9\u5F0F\u53D1\u8D77\u901A\u8BDD");
    render();
  }
  const mediaResult = await ensureLocalMediaActive({
    withCamera: mediaType === CALL_MEDIA.video,
    withMicrophone: true,
    reason: "outgoing_preflight",
    allowCameraFailure: mediaType === CALL_MEDIA.video,
    noticeOnCameraFailure: "\u672A\u83B7\u5F97\u6444\u50CF\u5934\u6743\u9650\uFF0C\u5C06\u4EE5\u8BED\u97F3\u65B9\u5F0F\u53D1\u8D77\u901A\u8BDD",
    permissionResult,
    expectedSessionKey
  });
  if (mediaResult.aborted || isExpectedSessionStale(expectedSessionKey)) {
    diagLog(
      "start_outgoing_call_skip_stale_engine_call",
      buildExpectedSessionSnapshot("outgoing_preflight_complete", expectedSessionKey)
    );
    await cleanupActiveMedia();
    return;
  }
  if (mediaType === CALL_MEDIA.video) {
    state.preferredVideoEnabled = mediaResult.cameraGranted === true;
  }
  const offlinePushInfo = buildOfflinePushInfo(payload, mediaType);
  diagLog("start_outgoing_call_offline_push_info", {
    hasOfflinePushInfo: true,
    titleLength: offlinePushInfo.title.length,
    descriptionLength: offlinePushInfo.description.length,
    ignoreIOSBadge: offlinePushInfo.ignoreIOSBadge,
    iOSPushType: offlinePushInfo.iOSPushType,
    extensionLength: offlinePushInfo.extension.length
  });
  setStatusText("\u6B63\u5728\u547C\u53EB\u5BF9\u65B9...");
  state.callStartedAt = Date.now();
  ensureTickTimer();
  render();
  try {
    await state.engine.calls({
      userIDList: Array.isArray(payload.calleeAccounts) ? payload.calleeAccounts : [],
      type: toCallType(mediaType),
      strRoomID: safeString(payload.roomId),
      timeout: safeNumber(payload.timeoutSec) || 30,
      userData: safeString(payload.userData),
      offlinePushInfo
    });
  } catch (error) {
    await cleanupActiveMedia();
    throw error;
  }
  render();
  postToFlutter("calling", {
    roomId: state.activeRoomId,
    mediaType: state.activeMediaType,
    userData: state.lastUserData
  });
}
async function logout() {
  await destroyEngine();
}
async function handleMessage(message) {
  const type = safeString(message?.type);
  const payload = message?.payload || {};
  diagLog("handle_message", {
    type,
    payload: summarizeDiagPayload(payload),
    initialized: state.initialized,
    phase: state.phase,
    connectionRole: state.connectionRole
  });
  try {
    switch (type) {
      case "bootstrap":
        await bootstrap(payload);
        return;
      case "media_permission_result":
        settleHostPermissionRequest(
          safeString(payload.requestId),
          normalizeHostPermissionResult(payload)
        );
        return;
      case "call":
        await startOutgoingCall(payload);
        return;
      case "accept":
        await acceptIncomingCall();
        return;
      case "reject":
        await rejectIncomingCall();
        return;
      case "hangup":
        await hangupCall();
        return;
      case "toggle_microphone":
        await toggleMicrophone();
        return;
      case "toggle_camera":
        await toggleCamera();
        return;
      case "toggle_speaker":
        await toggleSpeaker();
        return;
      case "terminate":
        if (state.phase === CALL_PHASE.incoming) {
          await rejectIncomingCall();
        } else {
          await hangupCall();
        }
        return;
      case "logout":
        await logout();
        return;
      case "show":
      case "hide":
      default:
        return;
    }
  } catch (error) {
    console.error("[DesktopCall] handleMessage failed", type, error);
    if (isPermissionError(error)) {
      emitPermissionDenied(error);
      return;
    }
    emitFatalError(
      error,
      type === "bootstrap" ? "\u684C\u9762\u901A\u8BDD\u521D\u59CB\u5316\u5931\u8D25" : "\u684C\u9762\u901A\u8BDD\u64CD\u4F5C\u5931\u8D25",
      {
        renderErrorUi: type === "bootstrap",
        preserveBootstrap: type !== "bootstrap"
      }
    );
  }
}
function bindWindowsHostMessages() {
  if (!window.chrome?.webview?.addEventListener) {
    return;
  }
  diagLog("bind_windows_host_messages", {});
  window.chrome.webview.addEventListener("message", (event) => {
    const parsed = parseHostEnvelope(event?.data);
    if (parsed) {
      diagLog("windows_host_message_received", {
        type: safeString(parsed?.type)
      });
      handleMessage(parsed);
    }
  });
}
function flushHostQueue() {
  const queue = window.__JOTMO_DESKTOP_CALL_HOST__?.drain?.() || [];
  diagLog("flush_host_queue", {
    count: Array.isArray(queue) ? queue.length : 0
  });
  queue.forEach((item) => {
    const parsed = parseHostEnvelope(item) ?? item;
    handleMessage(parsed);
  });
}
function init() {
  diagLog("init_start", {
    hasChromeWebView: Boolean(window.chrome?.webview?.postMessage),
    hasFlutterBridge: Boolean(resolveFlutterBridge())
  });
  installEmbeddedMediaPresentationGuard();
  document.addEventListener("visibilitychange", () => {
    diagLog("document_visibility_change", captureRuntimeSnapshot());
  });
  window.addEventListener("focus", () => {
    diagLog("window_focus", captureRuntimeSnapshot());
  });
  window.addEventListener("blur", () => {
    diagLog("window_blur", captureRuntimeSnapshot());
  });
  window.addEventListener("error", (event) => {
    diagLog("window_error", {
      message: trimDiagText(event?.message),
      filename: trimDiagText(event?.filename),
      lineno: Number(event?.lineno) || 0,
      colno: Number(event?.colno) || 0
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    diagLog("window_unhandled_rejection", {
      reason: trimDiagText(event?.reason?.message || event?.reason)
    });
  });
  mountShell();
  bindWindowsHostMessages();
  if (window.__JOTMO_DESKTOP_CALL_HOST__?.subscribe) {
    window.__JOTMO_DESKTOP_CALL_HOST__.subscribe(flushHostQueue);
  }
  flushHostQueue();
}
init();
