import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { Books } from "@phosphor-icons/react/dist/icons/Books";
import { CaretDown } from "@phosphor-icons/react/dist/icons/CaretDown";
import { CaretRight } from "@phosphor-icons/react/dist/icons/CaretRight";
import { Check } from "@phosphor-icons/react/dist/icons/Check";
import { FileText } from "@phosphor-icons/react/dist/icons/FileText";
import { FolderOpen } from "@phosphor-icons/react/dist/icons/FolderOpen";
import { Lightbulb } from "@phosphor-icons/react/dist/icons/Lightbulb";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/icons/MagnifyingGlass";
import { Plus } from "@phosphor-icons/react/dist/icons/Plus";
import { Sparkle } from "@phosphor-icons/react/dist/icons/Sparkle";
import { Trash } from "@phosphor-icons/react/dist/icons/Trash";
import type { Icon } from "@phosphor-icons/react/lib";
import type { ArkmeUserProfile, ArkmeUserProfileSnapshot } from "../types.js";
import { callArkme } from "./api.js";
import { ArkmeUserAvatar } from "./ArkmeAvatar.js";

declare const __ARKME_WORKBENCH_PUBLIC__: boolean;

type Kind =
  | "inspiration"
  | "topic"
  | "draft"
  | "material"
  | "work"
  | "template"
  | "hardware";
type Status = "collected" | "developing" | "ready" | "done";
type Entry = {
  id: string;
  kind: Kind;
  categoryId: string;
  title: string;
  content: string;
  status: Status;
  createdAt: number;
  updatedAt?: number;
  tags?: string[];
  nextAction?: string;
};
type Category = {
  id: string;
  name: string;
  kind: Kind;
  parentId: string | null;
  createdAt: number;
};
type CategoryMenu = { categoryId: string; x: number; y: number };
type DailyPlanItem = { id: string; text: string; completed: boolean; createdAt: number };
type DailyPlan = { items: DailyPlanItem[]; note: string };
type HeroCopy = { title: string; subtitle: string; flow: string; accountLabel: string; accountName: string; accountNote: string };
type CategoryPageCopy = {
  heroHint: string;
  heroPath: string;
  mapKicker: string;
  mapTitle: string;
  mapIntro: string;
  customiseKicker: string;
  customiseTitle: string;
  customiseIntro: string;
  recentKicker: string;
  recentTitle: string;
  captureKicker: string;
  captureTitle: string;
  captureIntro: string;
  libraryKicker: string;
  libraryTitle: string;
  libraryIntro: string;
};
type DashboardCopy = {
  pulseKicker: string;
  pulseTitle: string;
  pulseIntro: string;
  activityKicker: string;
  activityTitle: string;
  activityNote: string;
  nextKicker: string;
  nextTitle: string;
  mapKicker: string;
  mapTitle: string;
  recentKicker: string;
  recentTitle: string;
  overviewKicker: string;
  overviewTitle: string;
  overviewIntro: string;
  managerKicker: string;
  managerTitle: string;
  managerIntro: string;
  overviewRecentKicker: string;
  overviewRecentTitle: string;
  emptyTitle: string;
  emptyIntro: string;
  catNote: string;
};
const IS_PUBLIC_BUILD = typeof __ARKME_WORKBENCH_PUBLIC__ !== "undefined" && __ARKME_WORKBENCH_PUBLIC__;
const STORAGE_SCOPE = IS_PUBLIC_BUILD ? "arkme.public-workbench" : "arkme.workbench";
const ENTRY_KEY = `${STORAGE_SCOPE}.library.v1`;
const CATEGORY_KEY = `${STORAGE_SCOPE}.categories.v1`;
const EXPERIENCE_KEY = `${STORAGE_SCOPE}.experience.v1`;
const HERO_KEY = `${STORAGE_SCOPE}.hero.v1`;
const CATEGORY_PAGE_COPY_KEY = `${STORAGE_SCOPE}.category-page-copy.v1`;
const DASHBOARD_COPY_KEY = `${STORAGE_SCOPE}.dashboard-copy.v1`;
const DAILY_PLAN_KEY = `${STORAGE_SCOPE}.daily-plan.v1`;
const heroSeed: HeroCopy = { title: IS_PUBLIC_BUILD ? "工作台" : "Falling", subtitle: "这里收着你的灵感，也收着它们长成作品的过程。", flow: "灵感 → 选题 → 草稿 → 发布 → 复盘", accountLabel: "我的工作台", accountName: "", accountNote: "本地个人资源库" };
const dashboardCopySeed: DashboardCopy = {
  pulseKicker: "Creative pulse",
  pulseTitle: "你的创作正在发生",
  pulseIntro: "从收集到完成，每一份内容只保留一个真实状态。",
  activityKicker: "28 days",
  activityTitle: "创作足迹",
  activityNote: "不是催促，只是帮你看见已经积累下来的节奏。",
  nextKicker: "Next action",
  nextTitle: "建议继续推进",
  mapKicker: "Library map",
  mapTitle: "资源库分布",
  recentKicker: "Recently",
  recentTitle: "最近更新",
  overviewKicker: "Category map",
  overviewTitle: "我的资料版图",
  overviewIntro: "点击任一分类即可进入真实资料；有三级分类时，也可以从卡片内直接进入。",
  managerKicker: "Customise",
  managerTitle: "新建分类",
  managerIntro: "可在一级分类下新建二级，也可在二级分类下新建三级。",
  overviewRecentKicker: "Recently",
  overviewRecentTitle: "最近资料",
  emptyTitle: "这个分类还没有内容",
  emptyIntro: "从左边写下第一份资料，它会保存在你的本地资源库。",
  catNote: "先收下来，再慢慢写。",
};
const categoryPageCopySeed = (category: Category): CategoryPageCopy => ({
  heroHint: meta[category.kind].hint,
  heroPath: `${meta[category.kind].label} / ${category.name}`,
  mapKicker: "Category map",
  mapTitle: `${category.name}的全部分类`,
  mapIntro: "点击任一分类即可进入真实资料；有三级分类时，也可以从卡片内直接进入。",
  customiseKicker: "Customise",
  customiseTitle: "新建分类",
  customiseIntro: "可在一级分类下新建二级，也可在二级分类下新建三级。",
  recentKicker: "Recently",
  recentTitle: "最近资料",
  captureKicker: "Quick capture",
  captureTitle: "在这里新建资料",
  captureIntro: `当前进入的是“${category.name}”，写下的内容会保存到你选择的具体分类。`,
  libraryKicker: "My drafts",
  libraryTitle: category.name,
  libraryIntro: "这里是属于你的实际草稿和资料。三级分类会一并汇总在当前二级分类中。",
});
const meta: Record<Kind, { label: string; hint: string; icon: Icon }> = {
  inspiration: {
    label: "灵感库",
    hint: "收藏触动你的句子、情绪和日常观察",
    icon: Lightbulb,
  },
  topic: {
    label: "选题库",
    hint: "把零散灵感变成可以推进的内容方向",
    icon: Sparkle,
  },
  draft: {
    label: "草稿库",
    hint: "保存正在写的标题、正文和视频脚本",
    icon: FileText,
  },
  material: {
    label: "素材库",
    hint: "沉淀金句、案例、封面和参考资料",
    icon: Books,
  },
  work: { label: "作品库", hint: "归档已经完成或发布的内容", icon: FolderOpen },
  template: {
    label: "模板",
    hint: "保存可以反复使用的创作方法",
    icon: FileText,
  },
  hardware: {
    label: "硬件库",
    hint: "整理竞品、洞察、方案和会议记录",
    icon: FolderOpen,
  },
};
const kinds = Object.keys(meta) as Kind[];
const root = (kind: Kind) => `root-${kind}`;
const leaf = (kind: Kind) => `default-${kind}`;
function privateCategoriesSeed(): Category[] {
  return [
  ...kinds.map((kind, createdAt) => ({
    id: root(kind),
    name: meta[kind].label,
    kind,
    parentId: null,
    createdAt,
  })),
  {
    id: leaf("inspiration"),
    name: "随手灵感",
    kind: "inspiration",
    parentId: root("inspiration"),
    createdAt: 20,
  },
  {
    id: "emotion-inspiration",
    name: "情绪共鸣",
    kind: "inspiration",
    parentId: root("inspiration"),
    createdAt: 21,
  },
  {
    id: "comments-emotion",
    name: "评论区火花",
    kind: "inspiration",
    parentId: "emotion-inspiration",
    createdAt: 22,
  },
  {
    id: leaf("topic"),
    name: "待扩写",
    kind: "topic",
    parentId: root("topic"),
    createdAt: 23,
  },
  {
    id: "graphic-topic",
    name: "图文选题",
    kind: "topic",
    parentId: root("topic"),
    createdAt: 24,
  },
  {
    id: "video-topic",
    name: "视频选题",
    kind: "topic",
    parentId: root("topic"),
    createdAt: 25,
  },
  {
    id: leaf("draft"),
    name: "写作中",
    kind: "draft",
    parentId: root("draft"),
    createdAt: 26,
  },
  {
    id: leaf("material"),
    name: "参考资料",
    kind: "material",
    parentId: root("material"),
    createdAt: 27,
  },
  {
    id: leaf("work"),
    name: "已发布",
    kind: "work",
    parentId: root("work"),
    createdAt: 28,
  },
  {
    id: leaf("template"),
    name: "创作方法",
    kind: "template",
    parentId: root("template"),
    createdAt: 29,
  },
  {
    id: leaf("hardware"),
    name: "产品记录",
    kind: "hardware",
    parentId: root("hardware"),
    createdAt: 30,
  },
  ];
}
const publicLeafNames: Record<Kind, string> = {
  inspiration: "灵感收集",
  topic: "待整理选题",
  draft: "写作中",
  material: "参考资料",
  work: "已发布",
  template: "创作方法",
  hardware: "产品记录",
};
const publicCategoriesSeed: Category[] = [
  ...kinds.map((kind, createdAt) => ({
    id: root(kind),
    name: meta[kind].label,
    kind,
    parentId: null,
    createdAt,
  })),
  ...kinds.map((kind, index) => ({
    id: leaf(kind),
    name: publicLeafNames[kind],
    kind,
    parentId: root(kind),
    createdAt: 20 + index,
  })),
];
function privateEntriesSeed(): Entry[] {
  return [
  {
    id: "seed-inspiration",
    kind: "inspiration",
    categoryId: "comments-emotion",
    title: "评论区里的一句话",
    content: "先把触动自己的原话留下，再补一句：它为什么让我停下来？",
    status: "collected",
    createdAt: 1783472400000,
  },
  {
    id: "seed-topic",
    kind: "topic",
    categoryId: leaf("topic"),
    title: "把日常观察变成内容选题",
    content: "从真实经历切入：发生了什么、以前怎么想、现在有什么新判断。",
    status: "developing",
    createdAt: 1783476000000,
  },
  {
    id: "seed-template",
    kind: "template",
    categoryId: leaf("template"),
    title: "小红书爆款拆解写稿 SOP",
    content: "钩子 → 冲突 → 真实细节 → 可带走的方法 → 评论区问题。",
    status: "ready",
    createdAt: 1783479600000,
  },
  ];
}
function monthSimulationEntries(now: number): Entry[] {
  const stamp = (daysAgo: number, hour = 10) => { const value = new Date(now); value.setHours(hour, 0, 0, 0); value.setDate(value.getDate() - daysAgo); return value.getTime(); };
  return [
    { id: "demo-month-inspiration", kind: "inspiration", categoryId: "emotion-inspiration", title: "雨天窗边的一句话", content: "<p>记录今天让自己停下来的细节，再写下它为什么值得继续展开。</p>", status: "collected", createdAt: stamp(27), updatedAt: stamp(24, 18), tags: ["日常观察", "灵感"], nextAction: "补充当时的场景和感受" },
    { id: "demo-month-topic", kind: "topic", categoryId: leaf("topic"), title: "把零散观察整理成一个选题", content: "<h2>切入方式</h2><p>从真实场景开始，再补充变化、判断和读者可以带走的方法。</p>", status: "developing", createdAt: stamp(23), updatedAt: stamp(15, 14), tags: ["选题", "写作"], nextAction: "确定一个最具体的开头" },
    { id: "demo-month-draft", kind: "draft", categoryId: leaf("draft"), title: "周末散步记录初稿", content: "<h2>开头</h2><p>一条熟悉的路，因为放慢脚步而出现了新的细节。</p>", status: "ready", createdAt: stamp(19), updatedAt: stamp(5, 20), tags: ["草稿", "生活"], nextAction: "补充两张配图说明" },
    { id: "demo-month-material", kind: "material", categoryId: leaf("material"), title: "参考资料整理方法", content: "<ol><li>保留来源。</li><li>写下自己的判断。</li><li>标记下一次会在什么场景使用。</li></ol>", status: "done", createdAt: stamp(16), updatedAt: stamp(12, 11), tags: ["资料", "方法"], nextAction: "归档到对应选题" },
    { id: "demo-month-work", kind: "work", categoryId: leaf("work"), title: "本月完成作品", content: "<p>已完成的内容会保留最终版本、发布时间和复盘备注。</p>", status: "done", createdAt: stamp(13), updatedAt: stamp(2, 9), tags: ["作品", "复盘"], nextAction: "记录发布后的反馈" },
    { id: "demo-month-template", kind: "template", categoryId: leaf("template"), title: "从灵感到发布的检查清单", content: "<p>灵感 → 选题 → 草稿 → 校对 → 发布 → 复盘。</p>", status: "ready", createdAt: stamp(9), updatedAt: stamp(3, 16), tags: ["模板", "流程"], nextAction: "下次创作时直接复用" },
    { id: "demo-month-hardware", kind: "hardware", categoryId: leaf("hardware"), title: "产品体验观察", content: "<p>记录使用场景、问题、亮点和下一步需要验证的假设。</p>", status: "developing", createdAt: stamp(6), updatedAt: stamp(1, 13), tags: ["产品", "观察"], nextAction: "补充一个真实使用场景" },
  ];
}
const labels: Record<Status, string> = {
  collected: "刚收集",
  developing: "创作中",
  ready: "待发布",
  done: "已完成",
};
const next: Record<Status, Status> = {
  collected: "developing",
  developing: "ready",
  ready: "done",
  done: "collected",
};
const id = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const date = (value: number) =>
  new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(
    new Date(value),
  );
const previewText = (value: string) => value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
function below(categories: Category[], categoryId: string): string[] {
  return [
    categoryId,
    ...categories
      .filter((item) => item.parentId === categoryId)
      .flatMap((item) => below(categories, item.id)),
  ];
}
function readCategories(): Category[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(CATEGORY_KEY) ?? "null",
    ) as unknown;
    return Array.isArray(value) && value.length >= kinds.length
      ? (value as Category[])
      : IS_PUBLIC_BUILD ? publicCategoriesSeed : privateCategoriesSeed();
  } catch {
    return IS_PUBLIC_BUILD ? publicCategoriesSeed : privateCategoriesSeed();
  }
}
function readEntries(): Entry[] {
  const simulation = IS_PUBLIC_BUILD ? [] : monthSimulationEntries(Date.now());
  const initialEntries = IS_PUBLIC_BUILD ? [] : privateEntriesSeed();
  try {
    const value = JSON.parse(
      localStorage.getItem(ENTRY_KEY) ?? "null",
    ) as unknown;
    if (!Array.isArray(value)) return [...simulation, ...initialEntries];
    const stored = value
      .map((raw) => {
        const item = raw as Entry;
        return {
          ...item,
          updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : item.createdAt,
          tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === "string") : [],
          nextAction: typeof item.nextAction === "string" ? item.nextAction : "",
          categoryId:
            typeof item.categoryId === "string"
              ? item.categoryId
              : leaf(item.kind),
        };
      })
      .filter(
        (item) => typeof item.id === "string" && kinds.includes(item.kind),
      );
    return [...simulation.filter((entry) => !stored.some((item) => item.id === entry.id)), ...stored];
  } catch {
    return [...simulation, ...initialEntries];
  }
}
function Cat({ note }: { note: ReactNode }) {
  return (
    <aside className="arkme-workbench-cat" aria-label="工作台小猫">
      <span className="arkme-workbench-cat-note">{note}</span>
      <span className="arkme-workbench-cat-body">
        <i className="left" />
        <i className="right" />
        <b>
          <i />
          <i />
          <em />
        </b>
        <u />
      </span>
    </aside>
  );
}

export function ArkmeWorkbenchSurface() {
  const [profile, setProfile] = useState<ArkmeUserProfile>();
  const [categories, setCategories] = useState<Category[]>(() => IS_PUBLIC_BUILD ? publicCategoriesSeed : privateCategoriesSeed());
  const [entries, setEntries] = useState<Entry[]>(() => IS_PUBLIC_BUILD ? [] : privateEntriesSeed());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(new Set(kinds.map(root)));
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [captureId, setCaptureId] = useState(leaf("inspiration"));
  const [parentId, setParentId] = useState(root("inspiration"));
  const [categoryName, setCategoryName] = useState("");
  const [saved, setSaved] = useState(false);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [editorTitle, setEditorTitle] = useState("");
  const [categoryMenu, setCategoryMenu] = useState<CategoryMenu | null>(null);
  const [experience, setExperience] = useState<"original" | "preview">("preview");
  const [search, setSearch] = useState("");
  const [specialView, setSpecialView] = useState<"dashboard" | "pending">("dashboard");
  const [editorStatus, setEditorStatus] = useState<Status>("collected");
  const [editorTags, setEditorTags] = useState("");
  const [editorNextAction, setEditorNextAction] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [heroCopy, setHeroCopy] = useState<HeroCopy>(heroSeed);
  const [categoryPageCopy, setCategoryPageCopy] = useState<Record<string, Partial<CategoryPageCopy>>>({});
  const [dashboardCopy, setDashboardCopy] = useState<DashboardCopy>(dashboardCopySeed);
  const [editingPageCopy, setEditingPageCopy] = useState<string | null>(null);
  const [quickAddParentId, setQuickAddParentId] = useState<string | null | undefined>(undefined);
  const [quickAddName, setQuickAddName] = useState("");
  const [dailyPlans, setDailyPlans] = useState<Record<string, DailyPlan>>({});
  const [dailyPlanInput, setDailyPlanInput] = useState("");
  const [dailyPlansLoaded, setDailyPlansLoaded] = useState(false);
  const [dailyPlanHistoryOpen, setDailyPlanHistoryOpen] = useState(false);
  const [editingDailyPlanItemId, setEditingDailyPlanItemId] = useState<string | null>(null);
  const [editingHistoryPlanItemId, setEditingHistoryPlanItemId] = useState<string | null>(null);
  const [selectedPlanDate, setSelectedPlanDate] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const todayKey = useMemo(() => {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, [now]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setCategories(readCategories());
    setEntries(readEntries());
    setExperience(localStorage.getItem(EXPERIENCE_KEY) === "original" ? "original" : "preview");
    try { setHeroCopy({ ...heroSeed, ...JSON.parse(localStorage.getItem(HERO_KEY) ?? "{}") }); } catch { setHeroCopy(heroSeed); }
    try { setCategoryPageCopy(JSON.parse(localStorage.getItem(CATEGORY_PAGE_COPY_KEY) ?? "{}")); } catch { setCategoryPageCopy({}); }
    try { setDashboardCopy({ ...dashboardCopySeed, ...JSON.parse(localStorage.getItem(DASHBOARD_COPY_KEY) ?? "{}") }); } catch { setDashboardCopy(dashboardCopySeed); }
    try {
      const storedPlans = JSON.parse(localStorage.getItem(DAILY_PLAN_KEY) ?? "{}");
      setDailyPlans(storedPlans && typeof storedPlans === "object" && !Array.isArray(storedPlans) ? storedPlans : {});
    } catch { setDailyPlans({}); }
    setDailyPlansLoaded(true);
    const controller = new AbortController();
    void callArkme<ArkmeUserProfileSnapshot>(
      "user.profile",
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted && value.profile)
          setProfile(value.profile);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(ENTRY_KEY, JSON.stringify(entries));
    } catch {}
  }, [entries]);
  useEffect(() => {
    try {
      localStorage.setItem(CATEGORY_KEY, JSON.stringify(categories));
    } catch {}
  }, [categories]);
  useEffect(() => {
    try { localStorage.setItem(EXPERIENCE_KEY, experience); } catch {}
  }, [experience]);
  useEffect(() => {
    try { localStorage.setItem(HERO_KEY, JSON.stringify(heroCopy)); } catch {}
  }, [heroCopy]);
  useEffect(() => {
    try { localStorage.setItem(CATEGORY_PAGE_COPY_KEY, JSON.stringify(categoryPageCopy)); } catch {}
  }, [categoryPageCopy]);
  useEffect(() => {
    try { localStorage.setItem(DASHBOARD_COPY_KEY, JSON.stringify(dashboardCopy)); } catch {}
  }, [dashboardCopy]);
  useEffect(() => {
    if (!dailyPlansLoaded) return;
    try { localStorage.setItem(DAILY_PLAN_KEY, JSON.stringify(dailyPlans)); } catch {}
  }, [dailyPlans, dailyPlansLoaded]);
  const todayPlan = dailyPlans[todayKey] ?? { items: [], note: "" };
  const completedPlanItems = todayPlan.items.filter((item) => item.completed).length;
  const planDates = Object.keys(dailyPlans)
    .filter((dateKey) => {
      const plan = dailyPlans[dateKey];
      return Boolean(plan && (plan.items.length > 0 || plan.note.trim()));
    })
    .sort((a, b) => b.localeCompare(a));
  const visiblePlanDate = selectedPlanDate && dailyPlans[selectedPlanDate] ? selectedPlanDate : planDates[0];
  const visibleHistoryPlan = visiblePlanDate ? dailyPlans[visiblePlanDate] : undefined;
  const updatePlanForDate = (dateKey: string, update: (plan: DailyPlan) => DailyPlan) => {
    setDailyPlans((current) => ({
      ...current,
      [dateKey]: update(current[dateKey] ?? { items: [], note: "" }),
    }));
  };
  const updateTodayPlan = (update: (plan: DailyPlan) => DailyPlan) => updatePlanForDate(todayKey, update);
  const addDailyPlanItem = () => {
    const text = dailyPlanInput.trim();
    if (!text) return;
    updateTodayPlan((plan) => ({
      ...plan,
      items: [...plan.items, { id: id("daily-plan"), text, completed: false, createdAt: Date.now() }],
    }));
    setDailyPlanInput("");
  };
  const selected = categories.find((item) => item.id === selectedId);
  const selectedPageCopy = selected
    ? { ...categoryPageCopySeed(selected), ...(categoryPageCopy[selected.id] ?? {}) }
    : undefined;
  const updateSelectedPageCopy = (field: keyof CategoryPageCopy, value: string) => {
    if (!selected) return;
    setCategoryPageCopy((current) => ({
      ...current,
      [selected.id]: { ...(current[selected.id] ?? {}), [field]: value },
    }));
  };
  const updateSelectedCategoryName = (value: string) => {
    if (!selected) return;
    setCategories((current) => current.map((item) => item.id === selected.id ? { ...item, name: value } : item));
  };
  const editablePageCopy = (field: keyof CategoryPageCopy, ariaLabel: string, multiline = false) => {
    const value = selectedPageCopy?.[field] ?? "";
    if (editingPageCopy !== field) {
      return <button type="button" className="arkme-page-copy-trigger" onClick={() => setEditingPageCopy(field)} aria-label={`${ariaLabel}，点击修改`}>{value}</button>;
    }
    const shared = {
      className: "arkme-inline-copy-edit",
      "aria-label": ariaLabel,
      value,
      autoFocus: true,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateSelectedPageCopy(field, event.target.value),
      onBlur: () => setEditingPageCopy(null),
      onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (!multiline && event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") event.currentTarget.blur();
      },
    };
    return multiline ? <textarea {...shared} className="arkme-inline-copy-edit arkme-inline-copy-area" rows={2} /> : <input {...shared} />;
  };
  const editableDashboardCopy = (field: keyof DashboardCopy, ariaLabel: string, multiline = false) => {
    const editingKey = `dashboard:${field}`;
    const value = dashboardCopy[field];
    if (editingPageCopy !== editingKey) {
      return <button type="button" className="arkme-page-copy-trigger" onClick={() => setEditingPageCopy(editingKey)} aria-label={`${ariaLabel}，点击修改`}>{value}</button>;
    }
    const shared = {
      className: "arkme-inline-copy-edit",
      "aria-label": ariaLabel,
      value,
      autoFocus: true,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDashboardCopy((current) => ({ ...current, [field]: event.target.value })),
      onBlur: () => setEditingPageCopy(null),
      onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (!multiline && event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") event.currentTarget.blur();
      },
    };
    return multiline ? <textarea {...shared} className="arkme-inline-copy-edit arkme-inline-copy-area" rows={2} /> : <input {...shared} />;
  };
  const children = selected
    ? categories.filter((item) => item.parentId === selected.id)
    : [];
  const overview = !selected || selected.parentId === null;
  const selectedEntries = entries
    .filter(
      (item) =>
        !selected || below(categories, selected.id).includes(item.categoryId),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  const count = (categoryId: string) =>
    entries.filter((item) =>
      below(categories, categoryId).includes(item.categoryId),
    ).length;
  const categoryLevel = (category: Category) => {
    let level = 1;
    let parent = categories.find((item) => item.id === category.parentId);
    while (parent) {
      level += 1;
      parent = categories.find((item) => item.id === parent?.parentId);
    }
    return level;
  };
  const leaves = categories.filter((item) =>
    categories.every((other) => other.parentId !== item.id),
  );
  const capture = categories.find((item) => item.id === captureId) ?? leaves[0];
  const openEntry = entries.find((item) => item.id === openEntryId);
  const searchableEntries = entries.filter((entry) => {
    const category = categories.find((item) => item.id === entry.categoryId)?.name ?? "";
    const haystack = [entry.title, previewText(entry.content), entry.nextAction, ...(entry.tags ?? []), category].join(" ").toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });
  const pendingEntries = entries
    .filter((entry) => entry.status !== "done")
    .sort((a, b) => (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt));
  const statusCount = (status: Status) => entries.filter((entry) => entry.status === status).length;
  const activityDays = Array.from({ length: 28 }, (_, index) => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (27 - index));
    const end = start.getTime() + 86400000;
    return entries.filter((entry) => {
      const stamp = entry.updatedAt ?? entry.createdAt;
      return stamp >= start.getTime() && stamp < end;
    }).length;
  });
  const displayName = profile?.displayName || profile?.nickname || "我的工作台";
  const editableHeroCopy = (field: keyof HeroCopy, ariaLabel: string, className: string, displayValue = heroCopy[field]) => {
    const editingKey = `hero:${field}`;
    if (editingPageCopy !== editingKey) {
      return <button type="button" className={`arkme-page-copy-trigger arkme-hero-copy-trigger ${className}`} onClick={() => setEditingPageCopy(editingKey)} aria-label={`${ariaLabel}，点击修改`}>{displayValue}</button>;
    }
    return <input autoFocus className={`arkme-hero-edit ${className}`} aria-label={ariaLabel} value={displayValue} onChange={(event) => setHeroCopy((current) => ({ ...current, [field]: event.target.value }))} onBlur={() => setEditingPageCopy(null)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur(); }} />;
  };
  function choose(category: Category) {
    setCategoryMenu(null);
    setSpecialView("dashboard");
    setSelectedId(category.id);
    const first = below(categories, category.id)
      .map((value) => categories.find((item) => item.id === value))
      .find(
        (item) =>
          item && categories.every((other) => other.parentId !== item.id),
      );
    if (first) setCaptureId(first.id);
    if (!category.parentId) setParentId(category.id);
  }
  function toggle(categoryId: string) {
    setExpanded((current) => {
      const value = new Set(current);
      value.has(categoryId) ? value.delete(categoryId) : value.add(categoryId);
      return value;
    });
  }
  function tree(parent: string | null, level = 1): ReactNode {
    return categories
      .filter((item) => item.parentId === parent)
      .map((category) => {
        const kids = categories.filter((item) => item.parentId === category.id);
        const Icon = meta[category.kind].icon;
        return (
          <div
            className={`arkme-vault-tree-node level-${level}`}
            key={category.id}
          >
            <div
              className={`arkme-vault-tree-row ${selectedId === category.id ? "active" : ""}`}
              onContextMenu={(event) => {
                event.preventDefault();
                setCategoryMenu({
                  categoryId: category.id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              {kids.length ? (
                <button
                  type="button"
                  className="arkme-vault-disclosure"
                  aria-label={`${expanded.has(category.id) ? "收起" : "展开"}${category.name}`}
                  onClick={() => toggle(category.id)}
                >
                  {expanded.has(category.id) ? (
                    <CaretDown size={13} />
                  ) : (
                    <CaretRight size={13} />
                  )}
                </button>
              ) : (
                <span className="arkme-vault-disclosure" />
              )}
              <button
                type="button"
                className="arkme-vault-category"
                onClick={() => choose(category)}
              >
                {level === 1 ? <Icon size={16} /> : <FolderOpen size={14} />}
                <span>{category.name}</span>
                <em>{count(category.id)}</em>
              </button>
              {level < 3 && (
                <button
                  type="button"
                  className="arkme-vault-quick-add"
                  aria-label={`在${category.name}中新建下级分类`}
                  title="新建下级分类"
                  onMouseDown={(event) => { event.stopPropagation(); beginQuickAdd(category); }}
                  onClick={(event) => {
                    event.stopPropagation();
                    beginQuickAdd(category);
                  }}
                >
                  <Plus size={13} />
                </button>
              )}
            </div>
            {quickAddParentId === category.id && quickAddEditor(category)}
            {expanded.has(category.id) && (
              <div className="arkme-vault-tree-children">
                {tree(category.id, level + 1)}
              </div>
            )}
          </div>
        );
      });
  }
  function addCategory() {
    const name = categoryName.trim();
    const parent = categories.find((item) => item.id === parentId);
    if (!name || !parent) return;
    setCategories((current) => [
      ...current,
      {
        id: id("category"),
        name,
        kind: parent.kind,
        parentId: parent.id,
        createdAt: Date.now(),
      },
    ]);
    setExpanded((current) => new Set([...current, parent.id]));
    setCategoryName("");
  }
  function beginQuickAdd(parent: Category | null) {
    const level = parent ? categoryLevel(parent) + 1 : 1;
    if (level > 3) return;
    setQuickAddParentId(parent?.id ?? null);
    setQuickAddName("");
    if (parent) setExpanded((current) => new Set([...current, parent.id]));
  }
  function finishQuickAdd(parent: Category | null) {
    const level = parent ? categoryLevel(parent) + 1 : 1;
    const name = quickAddName.trim();
    if (!name) return;
    const next: Category = {
      id: id("category"),
      name,
      kind: parent?.kind ?? "inspiration",
      parentId: parent?.id ?? null,
      createdAt: Date.now(),
    };
    setCategories((current) => [...current, next]);
    if (parent) setExpanded((current) => new Set([...current, parent.id]));
    setSelectedId(next.id);
    setParentId(next.id);
    setCategoryMenu(null);
    setQuickAddParentId(undefined);
    setQuickAddName("");
  }
  function quickAddEditor(parent: Category | null) {
    const level = parent ? categoryLevel(parent) + 1 : 1;
    return (
      <form
        className={`arkme-vault-inline-add level-${level}`}
        onSubmit={(event) => { event.preventDefault(); finishQuickAdd(parent); }}
      >
        <FolderOpen size={14} />
        <input
          autoFocus
          aria-label={`输入新${["一级", "二级", "三级"][level - 1]}分类名称`}
          value={quickAddName}
          onChange={(event) => setQuickAddName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") setQuickAddParentId(undefined); }}
          placeholder={`新${["一级", "二级", "三级"][level - 1]}分类名称`}
        />
        <button type="submit" disabled={!quickAddName.trim()} aria-label="确认新建分类">添加</button>
        <button type="button" onClick={() => setQuickAddParentId(undefined)} aria-label="取消新建分类">取消</button>
      </form>
    );
  }
  function removeCategory(category: Category) {
    const ids = below(categories, category.id);
    if (!category.parentId) {
      setEntries((current) => current.filter((item) => !ids.includes(item.categoryId)));
      setCategories((current) => current.filter((item) => !ids.includes(item.id)));
      if (selectedId && ids.includes(selectedId)) setSelectedId(null);
      setCategoryMenu(null);
      return;
    }
    const parent = categories.find((item) => item.id === category.parentId);
    const fallback = parent?.parentId ? parent.id : leaf(category.kind);
    setEntries((current) =>
      current.map((item) =>
        ids.includes(item.categoryId)
          ? { ...item, categoryId: fallback }
          : item,
      ),
    );
    setCategories((current) =>
      current.filter((item) => !ids.includes(item.id)),
    );
    if (selectedId && ids.includes(selectedId))
      setSelectedId(parent?.id ?? root(category.kind));
  }
  function save() {
    if (!capture || (!title.trim() && !content.trim())) return;
    setEntries((current) => [
      {
        id: id("resource"),
        kind: capture.kind,
        categoryId: capture.id,
        title: title.trim() || content.trim().slice(0, 24),
        content: content.trim(),
        status: "collected",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: [],
        nextAction: "",
      },
      ...current,
    ]);
    setTitle("");
    setContent("");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1400);
  }
  function openEditor(entry: Entry) {
    setEditorTitle(entry.title);
    setEditorStatus(entry.status);
    setEditorTags((entry.tags ?? []).join("、"));
    setEditorNextAction(entry.nextAction ?? "");
    setEditorDirty(false);
    setOpenEntryId(entry.id);
  }
  function saveEditor() {
    if (!openEntry || !editorDirty) return;
    const nextContent = editorRef.current?.innerHTML ?? openEntry.content;
    setEntries((current) =>
      current.map((item) =>
        item.id === openEntry.id
          ? { ...item, title: editorTitle.trim() || item.title, content: nextContent, status: editorStatus, tags: editorTags.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean), nextAction: editorNextAction.trim(), updatedAt: Date.now() }
          : item,
      ),
    );
    setSaved(true);
    setEditorDirty(false);
    window.setTimeout(() => setSaved(false), 1400);
  }
  function editorCommand(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setEditorDirty(true);
  }
  function renameCategory(category: Category) {
    const name = window.prompt("重命名分类", category.name)?.trim();
    if (name) setCategories((current) => current.map((item) => item.id === category.id ? { ...item, name } : item));
    setCategoryMenu(null);
  }
  function duplicateCategory(category: Category) {
    const sourceIds = below(categories, category.id);
    const idMap = new Map(sourceIds.map((sourceId) => [sourceId, id("category-copy")]));
    const copies = categories.filter((item) => sourceIds.includes(item.id)).map((item) => ({ ...item, id: idMap.get(item.id)!, name: item.id === category.id ? `${item.name} 副本` : item.name, parentId: item.id === category.id ? item.parentId : idMap.get(item.parentId!)!, createdAt: Date.now() }));
    const entryCopies = entries.filter((item) => sourceIds.includes(item.categoryId)).map((item) => ({ ...item, id: id("resource-copy"), categoryId: idMap.get(item.categoryId)!, title: `${item.title} 副本`, createdAt: Date.now(), updatedAt: Date.now() }));
    setCategories((current) => [...current, ...copies]);
    setEntries((current) => [...entryCopies, ...current]);
    setCategoryMenu(null);
  }
  const cards = selected
    ? children
    : categories.filter((item) => item.parentId === null);
  return (
    <main
      className="arkme-workbench"
      data-arkme-owned="workbench-surface"
      aria-label="Arkme 工作台"
    >
      <div className="arkme-workbench-shell">
        <aside
          className="arkme-workbench-vault"
          aria-label="我的工作台三级资料栏"
        >
          <header>
            <span className="arkme-workbench-vault-mark" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none">
                <path d="M12 19.5h24M15 19.5v15M33 19.5v15M18 27h12" />
                <path d="M20 14h8l2 5.5H18L20 14Z" />
                <path className="spark" d="M37 11v5M34.5 13.5h5" />
              </svg>
            </span>
            <span>
              <strong>工作台</strong>
              <small>我的资料库</small>
            </span>
            <div className="arkme-workbench-experience" aria-label="工作台版本切换">
              <button type="button" className={experience === "original" ? "active" : ""} onClick={() => setExperience("original")}>原版</button>
              <button type="button" className={experience === "preview" ? "active" : ""} onClick={() => setExperience("preview")}>创作驾驶舱</button>
            </div>
          </header>
          <nav>
            <button
              type="button"
              className={`arkme-vault-home ${selectedId === null ? "active" : ""}`}
              onClick={() => { setSelectedId(null); setSpecialView("dashboard"); }}
            >
              <FolderOpen size={17} />
              <span>工作台总览</span>
              <em>{entries.length}</em>
            </button>
            {experience === "preview" && (
              <>
                <label className="arkme-vault-search">
                  <MagnifyingGlass size={15} />
                  <input aria-label="搜索我的资源库" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedId(null); }} placeholder="搜索标题、正文或标签" />
                </label>
                <button type="button" className={`arkme-vault-home ${specialView === "pending" && selectedId === null ? "active" : ""}`} onClick={() => { setSelectedId(null); setSpecialView("pending"); setSearch(""); }}>
                  <Sparkle size={17} /><span>待推进</span><em>{pendingEntries.length}</em>
                </button>
              </>
            )}
            <div className="arkme-vault-section-title">
              <small>我的分类</small>
              <button type="button" onMouseDown={(event) => { event.stopPropagation(); beginQuickAdd(null); }} onClick={(event) => { event.stopPropagation(); beginQuickAdd(null); }} aria-label="新建一级分类" title="新建一级分类"><Plus size={14} /></button>
            </div>
            {quickAddParentId === null && quickAddEditor(null)}
            {tree(null)}
          </nav>
          <footer>
            <ArkmeUserAvatar
              {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})}
              size={34}
              label="当前用户头像"
            />
            <span>
              <strong>{displayName}</strong>
              <small>本地个人空间</small>
            </span>
          </footer>
        </aside>
        <div className="arkme-workbench-content">
          <div className="arkme-workbench-canvas">
            <section className="arkme-workbench-hero arkme-workbench-card">
              <div className="arkme-workbench-date">
                <small>今天是</small>
                <strong>
                  {now.toLocaleDateString("zh-CN").replaceAll("/", " / ")}
                </strong>
                <span>
                  {new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(
                    now,
                  )}
                </span>
              </div>
              <div className="arkme-workbench-title">
                {selected ? editingPageCopy === "categoryTitle" ? <input autoFocus className="arkme-hero-edit arkme-hero-title-edit arkme-category-title-edit" aria-label="编辑当前分类标题" value={selected.name} onChange={(event) => updateSelectedCategoryName(event.target.value)} onBlur={() => setEditingPageCopy(null)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur(); }} /> : <button type="button" className="arkme-page-copy-trigger arkme-category-title-trigger" onClick={() => setEditingPageCopy("categoryTitle")} aria-label="编辑当前分类标题，点击修改">{selected.name}</button> : editableHeroCopy("title", "编辑工作台标题", "arkme-hero-title-edit")}
                {selected ? <div className="arkme-category-hint-trigger">{editablePageCopy("heroHint", "编辑当前分类说明")}</div> : editableHeroCopy("subtitle", "编辑工作台说明", "arkme-hero-subtitle-edit")}
                {selected ? <div className="arkme-category-path-trigger">{editablePageCopy("heroPath", "编辑当前分类路径")}</div> : editableHeroCopy("flow", "编辑工作台流程", "arkme-hero-flow-edit")}
              </div>
              <div className="arkme-workbench-account">
                <ArkmeUserAvatar
                  {...(profile?.avatarRef
                    ? { avatarRef: profile.avatarRef }
                    : {})}
                  size={42}
                  label="当前用户头像"
                />
                <span>
                  {editableHeroCopy("accountLabel", "编辑工作台标签", "arkme-account-label-edit")}
                  {editableHeroCopy("accountName", "编辑工作台名称", "arkme-account-name-edit", heroCopy.accountName || displayName)}
                  {editableHeroCopy("accountNote", "编辑工作台备注", "arkme-account-note-edit")}
                </span>
              </div>
            </section>
            {!selected && experience === "preview" ? (
              <>
                <section className="arkme-cockpit-summary" aria-label="创作驾驶舱概览">
                  <article className="arkme-cockpit-thesis">
                    <small className="arkme-workbench-kicker">{editableDashboardCopy("pulseKicker", "编辑创作状态小标题")}</small>
                    <h2>{search.trim() ? `找到 ${searchableEntries.length} 份相关资料` : specialView === "pending" ? "接下来，推进哪一份？" : editableDashboardCopy("pulseTitle", "编辑创作状态标题")}</h2>
                    {search.trim() || specialView === "pending" ? <p>{search.trim() ? "搜索同时覆盖标题、正文、标签、分类与下一步。" : "先处理最久没有更新的内容，保持创作流动。"}</p> : <div className="arkme-page-copy-description arkme-cockpit-copy-description">{editableDashboardCopy("pulseIntro", "编辑创作状态说明", true)}</div>}
                    <div className="arkme-cockpit-stage-line">
                      {(["collected", "developing", "ready", "done"] as Status[]).map((status) => (
                        <span key={status}><b>{statusCount(status)}</b><em>{labels[status]}</em></span>
                      ))}
                    </div>
                    <section className="arkme-daily-plan" aria-label="每日计划">
                      <header>
                        <span><small>Today plan</small><h3>每日计划</h3></span>
                        <div className="arkme-daily-plan-actions">
                          <strong>{todayPlan.items.length ? `${completedPlanItems} / ${todayPlan.items.length} 完成` : "今天"}</strong>
                          <button type="button" className={dailyPlanHistoryOpen ? "active" : ""} onClick={() => { setDailyPlanHistoryOpen((open) => !open); setSelectedPlanDate(null); }} aria-expanded={dailyPlanHistoryOpen} aria-controls="arkme-daily-plan-history">历史 {planDates.length ? `· ${planDates.length}` : ""}</button>
                        </div>
                      </header>
                      <div className="arkme-daily-plan-grid">
                        <div className="arkme-daily-plan-todos">
                          <div className="arkme-daily-plan-add">
                            <input
                              aria-label="新增今日待办"
                              value={dailyPlanInput}
                              onChange={(event) => setDailyPlanInput(event.target.value)}
                              onKeyDown={(event) => { if (event.key === "Enter") addDailyPlanItem(); }}
                              placeholder="写下今天要完成的事"
                            />
                            <button type="button" onClick={addDailyPlanItem} disabled={!dailyPlanInput.trim()} aria-label="添加今日待办"><Plus size={15} /></button>
                          </div>
                          <div className="arkme-daily-plan-list">
                            {todayPlan.items.length === 0 ? <p>今天还没有待办，从一件小事开始。</p> : todayPlan.items.map((item) => (
                              <div key={item.id} className={item.completed ? "is-complete" : ""}>
                                <button type="button" className="arkme-daily-plan-toggle" onClick={() => updateTodayPlan((plan) => ({ ...plan, items: plan.items.map((entry) => entry.id === item.id ? { ...entry, completed: !entry.completed } : entry) }))} aria-label={`${item.completed ? "恢复" : "完成"}待办：${item.text}`}><i>{item.completed && <Check size={11} weight="bold" />}</i></button>
                                {editingDailyPlanItemId === item.id ? <input autoFocus className="arkme-daily-plan-item-editor" aria-label={`修改待办：${item.text}`} value={item.text} onBlur={() => setEditingDailyPlanItemId(null)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onChange={(event) => updateTodayPlan((plan) => ({ ...plan, items: plan.items.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value } : entry) }))} /> : <button type="button" className="arkme-daily-plan-item-text" onClick={() => setEditingDailyPlanItemId(item.id)} aria-label={`编辑待办：${item.text}`}>{item.text}</button>}
                                <button type="button" className="arkme-daily-plan-delete" onClick={() => updateTodayPlan((plan) => ({ ...plan, items: plan.items.filter((entry) => entry.id !== item.id) }))} aria-label={`删除待办：${item.text}`}><Trash size={13} /></button>
                              </div>
                            ))}
                          </div>
                        </div>
                        <label className="arkme-daily-plan-note">
                          <span>随手记</span>
                          <textarea aria-label="今日随手记录" value={todayPlan.note} onChange={(event) => updateTodayPlan((plan) => ({ ...plan, note: event.target.value }))} placeholder="想到什么就记在这里……" rows={5} />
                        </label>
                      </div>
                      {dailyPlanHistoryOpen && (
                        <section id="arkme-daily-plan-history" className="arkme-daily-plan-history" aria-label="每日计划历史记录">
                          {planDates.length === 0 ? <div className="arkme-daily-plan-history-empty"><strong>还没有历史记录</strong><span>今天写下的待办或随手记，会在这里按日期保存。</span></div> : (
                            <>
                              <nav aria-label="选择计划日期">
                                {planDates.map((dateKey) => {
                                  const plan = dailyPlans[dateKey] ?? { items: [], note: "" };
                                  const completed = plan.items.filter((item) => item.completed).length;
                                  return <button type="button" key={dateKey} className={visiblePlanDate === dateKey ? "active" : ""} onClick={() => setSelectedPlanDate(dateKey)}><time dateTime={dateKey}>{dateKey === todayKey ? "今天" : new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${dateKey}T12:00:00`))}</time><span>{completed}/{plan.items.length}</span></button>;
                                })}
                              </nav>
                              {visibleHistoryPlan && visiblePlanDate && (
                                <article>
                                  <header><span><small>Daily archive</small><h4>{visiblePlanDate === todayKey ? "今天的记录" : visiblePlanDate}</h4></span><strong>{visibleHistoryPlan.items.filter((item) => item.completed).length} / {visibleHistoryPlan.items.length} 完成</strong></header>
                                  <div className="arkme-daily-plan-history-items">
                                    {visibleHistoryPlan.items.length === 0 ? <p>这一天没有待办。</p> : visibleHistoryPlan.items.map((item) => <div key={item.id} className={item.completed ? "is-complete" : ""}><button type="button" onClick={() => updatePlanForDate(visiblePlanDate, (plan) => ({ ...plan, items: plan.items.map((entry) => entry.id === item.id ? { ...entry, completed: !entry.completed } : entry) }))} aria-label={`${item.completed ? "恢复" : "完成"}历史待办：${item.text}`}><i>{item.completed && <Check size={10} weight="bold" />}</i></button>{editingHistoryPlanItemId === item.id ? <input autoFocus className="arkme-daily-plan-history-editor" aria-label={`修改历史待办：${item.text}`} value={item.text} onBlur={() => setEditingHistoryPlanItemId(null)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onChange={(event) => updatePlanForDate(visiblePlanDate, (plan) => ({ ...plan, items: plan.items.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value } : entry) }))} /> : <button type="button" className="arkme-daily-plan-history-text" onClick={() => setEditingHistoryPlanItemId(item.id)} aria-label={`编辑历史待办：${item.text}`}>{item.text}</button>}<button type="button" className="arkme-daily-plan-delete" aria-label={`删除历史待办：${item.text}`} onClick={() => updatePlanForDate(visiblePlanDate, (plan) => ({ ...plan, items: plan.items.filter((entry) => entry.id !== item.id) }))}><Trash size={12} /></button></div>)}
                                  </div>
                                  <label className="arkme-daily-plan-history-note"><small>随手记</small><textarea aria-label={`修改${visiblePlanDate}的随手记`} value={visibleHistoryPlan.note} onChange={(event) => updatePlanForDate(visiblePlanDate, (plan) => ({ ...plan, note: event.target.value }))} placeholder="这一天没有留下随手记。" rows={3} /></label>
                                </article>
                              )}
                            </>
                          )}
                        </section>
                      )}
                    </section>
                  </article>
                  <article className="arkme-cockpit-activity">
                    <header><span><small className="arkme-workbench-kicker">{editableDashboardCopy("activityKicker", "编辑创作足迹小标题")}</small><h2>{editableDashboardCopy("activityTitle", "编辑创作足迹标题")}</h2></span><strong>{activityDays.reduce((sum, value) => sum + value, 0)} 次更新</strong></header>
                    <div className="arkme-cockpit-heatmap" aria-label="最近二十八天创作热力图">
                      {activityDays.map((value, index) => <i key={index} className={`level-${Math.min(value, 4)}`} title={`${value} 次更新`} />)}
                    </div>
                    <div className="arkme-page-copy-description arkme-activity-copy-description">{editableDashboardCopy("activityNote", "编辑创作足迹说明", true)}</div>
                  </article>
                </section>
                <section className="arkme-cockpit-worklist">
                  <article className="arkme-workbench-card arkme-cockpit-next">
                    <header><span><small className="arkme-workbench-kicker">{editableDashboardCopy("nextKicker", "编辑下一步小标题")}</small><h2>{search.trim() ? "搜索结果" : specialView === "pending" ? "待推进内容" : editableDashboardCopy("nextTitle", "编辑下一步标题")}</h2></span><strong>{(search.trim() ? searchableEntries : pendingEntries).length} 份</strong></header>
                    {(search.trim() ? searchableEntries : pendingEntries).slice(0, 6).map((entry) => (
                      <button type="button" key={entry.id} onClick={() => openEditor(entry)}>
                        <span><em>{labels[entry.status]}</em><strong>{entry.title}</strong><small>{entry.nextAction || "补充下一步，让它继续向前。"}</small></span>
                        <time>{date(entry.updatedAt ?? entry.createdAt)}</time>
                      </button>
                    ))}
                  </article>
                  <article className="arkme-workbench-card arkme-cockpit-map">
                    <header><small className="arkme-workbench-kicker">{editableDashboardCopy("mapKicker", "编辑资源库分布小标题")}</small><h2>{editableDashboardCopy("mapTitle", "编辑资源库分布标题")}</h2></header>
                    {categories.filter((item) => item.parentId === null).map((category) => {
                      const total = count(category.id);
                      return <button type="button" key={category.id} onClick={() => choose(category)}><span>{category.name}</span><i><b style={{ width: `${entries.length ? Math.max(8, total / entries.length * 100) : 8}%` }} /></i><em>{total}</em></button>;
                    })}
                  </article>
                </section>
                <section className="arkme-workbench-card arkme-cockpit-recent">
                  <header><span><small className="arkme-workbench-kicker">{editableDashboardCopy("recentKicker", "编辑最近更新小标题")}</small><h2>{editableDashboardCopy("recentTitle", "编辑最近更新标题")}</h2></span></header>
                  {entries.slice().sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)).slice(0, 5).map((entry) => <button type="button" key={entry.id} onClick={() => openEditor(entry)}><span>{entry.title}</span><em>{categories.find((item) => item.id === entry.categoryId)?.name} · {labels[entry.status]}</em></button>)}
                </section>
              </>
            ) : overview ? (
              <>
                <section className="arkme-workbench-metrics">
                  {cards.slice(0, 4).map((category, index) => {
                    const Icon = meta[category.kind].icon;
                    return (
                      <button
                        type="button"
                        key={category.id}
                        className={`arkme-workbench-metric ${["green", "blue", "purple", "orange"][index]}`}
                        onClick={() => choose(category)}
                      >
                        <span>
                          <Icon size={20} />
                        </span>
                        <div>
                          <small>{category.name}</small>
                          <strong>{count(category.id)}</strong>
                        </div>
                      </button>
                    );
                  })}
                </section>
                <section className="arkme-workbench-overview-grid">
                  <article className="arkme-workbench-card arkme-category-board">
                    <header>
                      <span>
                        <small className="arkme-workbench-kicker">
                          {selected ? editablePageCopy("mapKicker", "编辑分类总览小标题") : editableDashboardCopy("overviewKicker", "编辑资料版图小标题")}
                        </small>
                        <h2>
                          {selected ? editablePageCopy("mapTitle", "编辑分类总览标题") : editableDashboardCopy("overviewTitle", "编辑资料版图标题")}
                        </h2>
                      </span>
                      <strong>{cards.length} 个入口</strong>
                    </header>
                    <div className="arkme-page-copy-description arkme-category-map-description">{selected ? editablePageCopy("mapIntro", "编辑分类总览说明", true) : editableDashboardCopy("overviewIntro", "编辑资料版图说明", true)}</div>
                    <div className="arkme-category-cards">
                      {cards.map((category) => {
                        const Icon = meta[category.kind].icon;
                        const kids = categories.filter(
                          (item) => item.parentId === category.id,
                        );
                        return (
                          <article
                            key={category.id}
                            className={`kind-${category.kind}`}
                          >
                            <button
                              type="button"
                              className="arkme-category-card-main"
                              onClick={() => choose(category)}
                            >
                              <span>
                                <Icon size={18} />
                              </span>
                              <strong>{category.name}</strong>
                              <em>{count(category.id)} 份资料</em>
                              <CaretRight size={15} />
                            </button>
                            {kids.length > 0 && (
                              <div className="arkme-category-card-children">
                                {kids.map((kid) => (
                                  <button
                                    type="button"
                                    key={kid.id}
                                    onClick={() => choose(kid)}
                                  >
                                    <span>{kid.name}</span>
                                    <em>{count(kid.id)}</em>
                                  </button>
                                ))}
                              </div>
                            )}
                            {category.parentId && (
                              <button
                                type="button"
                                className="arkme-category-delete"
                                aria-label={`删除分类${category.name}`}
                                onClick={() => removeCategory(category)}
                              >
                                <Trash size={13} />
                              </button>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </article>
                  <article className="arkme-workbench-card arkme-category-manager">
                    <header>
                      <small className="arkme-workbench-kicker">
                        {selected ? editablePageCopy("customiseKicker", "编辑新建分类小标题") : editableDashboardCopy("managerKicker", "编辑分类管理小标题")}
                      </small>
                      <h2>{selected ? editablePageCopy("customiseTitle", "编辑新建分类标题") : editableDashboardCopy("managerTitle", "编辑分类管理标题")}</h2>
                    </header>
                    <div className="arkme-page-copy-description arkme-category-manager-description">{selected ? editablePageCopy("customiseIntro", "编辑新建分类说明", true) : editableDashboardCopy("managerIntro", "编辑分类管理说明", true)}</div>
                    <label>
                      <span>上一级</span>
                      <select
                        value={parentId}
                        onChange={(event) => setParentId(event.target.value)}
                      >
                        {categories
                          .filter(
                            (item) =>
                              !item.parentId ||
                              categories.find(
                                (parent) => parent.id === item.parentId,
                              )?.parentId === null,
                          )
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.parentId ? `　↳ ${item.name}` : item.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <input
                      aria-label="新分类名称"
                      value={categoryName}
                      onChange={(event) => setCategoryName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") addCategory();
                      }}
                      placeholder="例如：内容灵感"
                    />
                    <button
                      type="button"
                      onClick={addCategory}
                      disabled={!categoryName.trim()}
                    >
                      <Plus size={16} /> 添加分类
                    </button>
                  </article>
                </section>
                <section className="arkme-workbench-card arkme-workbench-recent">
                  <header>
                    <span>
                      <small className="arkme-workbench-kicker">{selected ? editablePageCopy("recentKicker", "编辑最近资料小标题") : editableDashboardCopy("overviewRecentKicker", "编辑最近资料小标题")}</small>
                      <h2>{selected ? editablePageCopy("recentTitle", "编辑最近资料标题") : editableDashboardCopy("overviewRecentTitle", "编辑最近资料标题")}</h2>
                    </span>
                  </header>
                  {selectedEntries.slice(0, 4).map((entry) => (
                    <button
                      type="button"
                      key={entry.id}
                      onClick={() => {
                        const category = categories.find(
                          (item) => item.id === entry.categoryId,
                        );
                        if (category) choose(category);
                      }}
                    >
                      <span>{entry.title}</span>
                      <em>
                        {
                          categories.find(
                            (item) => item.id === entry.categoryId,
                          )?.name
                        }{" "}
                        · {date(entry.createdAt)}
                      </em>
                    </button>
                  ))}
                </section>
              </>
            ) : (
              <section className="arkme-workbench-main-grid">
                <article className="arkme-workbench-card arkme-workbench-capture">
                  <header>
                    <span>
                      <small className="arkme-workbench-kicker">
                        {editablePageCopy("captureKicker", "编辑快速新建区小标题")}
                      </small>
                      <h2>{editablePageCopy("captureTitle", "编辑快速新建区标题")}</h2>
                    </span>
                    <span className={saved ? "is-visible" : ""}>
                      <Check size={14} /> 已保存
                    </span>
                  </header>
                  <div className="arkme-page-copy-description">{editablePageCopy("captureIntro", "编辑快速新建区说明", true)}</div>
                  <label>
                    <span>保存到</span>
                    <select
                      value={captureId}
                      onChange={(event) => setCaptureId(event.target.value)}
                    >
                      {leaves
                        .filter((item) => item.kind === selected?.kind)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="草稿或资料标题"
                    aria-label="资源标题"
                  />
                  <textarea
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    placeholder="从这里开始写你的内容……"
                    aria-label="资源内容"
                    rows={8}
                  />
                  <button
                    type="button"
                    className="arkme-workbench-save"
                    onClick={save}
                    disabled={!title.trim() && !content.trim()}
                  >
                    <Plus size={17} /> 保存到 {capture?.name}
                  </button>
                </article>
                <article className="arkme-workbench-card arkme-workbench-library">
                  <header>
                    <span>
                      <small className="arkme-workbench-kicker">
                        {editablePageCopy("libraryKicker", "编辑资料列表小标题")}
                      </small>
                      <h2>{editablePageCopy("libraryTitle", "编辑资料列表标题")}</h2>
                    </span>
                    <strong>{selectedEntries.length} 份</strong>
                  </header>
                  <div className="arkme-workbench-library-intro arkme-page-copy-description">{editablePageCopy("libraryIntro", "编辑资料列表说明", true)}</div>
                  <div className="arkme-workbench-resource-list">
                    {selectedEntries.length === 0 ? (
                      <div className="arkme-workbench-empty">
                        <Books size={28} />
                        <strong>{editableDashboardCopy("emptyTitle", "编辑空分类标题")}</strong>
                        <span>{editableDashboardCopy("emptyIntro", "编辑空分类说明")}</span>
                      </div>
                    ) : (
                      selectedEntries.map((entry) => (
                        <article
                          key={entry.id}
                          className={`arkme-workbench-resource kind-${entry.kind}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`打开草稿${entry.title}`}
                          onClick={() => openEditor(entry)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ")
                              openEditor(entry);
                          }}
                        >
                          <header>
                            <span>
                              {categories.find(
                                (item) => item.id === entry.categoryId,
                              )?.name ?? meta[entry.kind].label}
                            </span>
                            <time>{date(entry.createdAt)}</time>
                          </header>
                          <h3>{entry.title}</h3>
                          {entry.content && <p>{previewText(entry.content)}</p>}
                          <footer>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEntries((current) =>
                                  current.map((item) =>
                                    item.id === entry.id
                                      ? { ...item, status: next[item.status], updatedAt: Date.now() }
                                      : item,
                                  ),
                                );
                              }}
                            >
                              {labels[entry.status]} <span>→</span>
                            </button>
                            <button
                              type="button"
                              aria-label={`删除${entry.title}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setEntries((current) =>
                                  current.filter(
                                    (item) => item.id !== entry.id,
                                  ),
                                );
                              }}
                            >
                              <Trash size={14} />
                            </button>
                          </footer>
                        </article>
                      ))
                    )}
                  </div>
                </article>
              </section>
            )}
            {openEntry && (
              <div
                className="arkme-entry-reader-backdrop"
                role="presentation"
                onClick={() => { saveEditor(); setOpenEntryId(null); }}
              >
                <article
                  className="arkme-entry-reader"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="arkme-entry-reader-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <header>
                    <button type="button" onClick={() => { saveEditor(); setOpenEntryId(null); }}>
                      <CaretRight size={15} /> 返回列表
                    </button>
                    <span>{meta[openEntry.kind].label}</span>
                  </header>
                  <div className="arkme-entry-reader-meta">
                    <span>
                      {categories.find(
                        (category) => category.id === openEntry.categoryId,
                      )?.name ?? meta[openEntry.kind].label}
                    </span>
                    <time>
                      {new Intl.DateTimeFormat("zh-CN", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      }).format(new Date(openEntry.createdAt))}
                    </time>
                    <em>{labels[openEntry.status]}</em>
                  </div>
                  {experience === "preview" && (
                    <div className="arkme-entry-workflow" aria-label="创作属性">
                      <label><span>状态</span><select value={editorStatus} onChange={(event) => { setEditorStatus(event.target.value as Status); setEditorDirty(true); }}>{(["collected", "developing", "ready", "done"] as Status[]).map((status) => <option key={status} value={status}>{labels[status]}</option>)}</select></label>
                      <label><span>标签</span><input value={editorTags} onChange={(event) => { setEditorTags(event.target.value); setEditorDirty(true); }} placeholder="例如：产品、观察、复盘" /></label>
                      <label className="wide"><span>下一步</span><input value={editorNextAction} onChange={(event) => { setEditorNextAction(event.target.value); setEditorDirty(true); }} placeholder="下一次打开时，我应该继续做什么？" /></label>
                    </div>
                  )}
                  <input id="arkme-entry-reader-title" className="arkme-entry-editor-title" value={editorTitle} onChange={(event) => { setEditorTitle(event.target.value); setEditorDirty(true); }} aria-label="草稿标题" />
                  <div className="arkme-entry-toolbar" aria-label="文字排版工具栏">
                    <select aria-label="段落样式" defaultValue="p" onChange={(event) => editorCommand("formatBlock", event.target.value)}><option value="p">正文</option><option value="h1">大标题</option><option value="h2">小标题</option><option value="blockquote">引用</option></select>
                    <select aria-label="字体" defaultValue="Georgia" onChange={(event) => editorCommand("fontName", event.target.value)}><option value="Georgia">优雅宋体</option><option value="Microsoft YaHei">清晰黑体</option><option value="KaiTi">手写楷体</option></select>
                    <select aria-label="字号" defaultValue="3" onChange={(event) => editorCommand("fontSize", event.target.value)}><option value="2">小字</option><option value="3">正文</option><option value="5">大字</option><option value="6">特大</option></select>
                    {[['bold', 'B'], ['italic', 'I'], ['insertUnorderedList', '• 列表'], ['insertOrderedList', '1. 列表'], ['insertHorizontalRule', '— 分隔线'], ['undo', '撤销'], ['redo', '重做']].map(([command, label]) => <button key={command} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => editorCommand(command ?? '')}>{label}</button>)}
                    <button type="button" className="arkme-entry-save" onClick={saveEditor}>{editorDirty ? '保存' : '已保存'}</button>
                  </div>
                  <div ref={editorRef} key={openEntry.id} className="arkme-entry-reader-content" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: openEntry.content || '<p>从这里开始写下你的内容……</p>' }} onInput={() => { setSaved(false); setEditorDirty(true); }} />
                </article>
              </div>
            )}
            {categoryMenu && (() => { const category = categories.find((item) => item.id === categoryMenu.categoryId); return category ? <div className="arkme-category-context-menu" role="menu" style={{ left: categoryMenu.x, top: categoryMenu.y }} onMouseLeave={() => setCategoryMenu(null)}><button type="button" role="menuitem" onClick={() => renameCategory(category)}>重命名</button><button type="button" role="menuitem" onClick={() => duplicateCategory(category)}>复制一层</button><button type="button" role="menuitem" onClick={() => { const message = category.parentId ? `删除“${category.name}”？里面的资料会移到上一级。` : `删除一级分类“${category.name}”？它的下级分类和其中资料也会一并删除。`; if (window.confirm(message)) removeCategory(category); setCategoryMenu(null); }}>删除</button></div> : null; })()}
            <Cat note={editableDashboardCopy("catNote", "编辑小猫提示语")} />
          </div>
        </div>
      </div>
    </main>
  );
}
