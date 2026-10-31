// UI text and formatting live here. Replace this dictionary to add another locale.
const pad = (value: number) => String(value).padStart(2, "0");
const timelineCopy = {
  heading: "変更履歴",
  empty: "まだ記録はありません",
  memoFallback: "削除されたメンバー",
};
const statusLabels = { todo: "未着手", doing: "進行中", done: "完了" };
const priorityLabels = { high: "高", medium: "中", low: "低" };
const noDeadlineLabel = "期限なし";
const assigneeNoneLabel = "担当者なし";
/** 承認フロー対象の特別タグ。src/model.ts の REQUEST_TAG と同じ文字列。 */
const REQUEST_TAG_LABEL = "申請";
const formatDeadline = (date: Date, withYear: boolean) =>
  (withYear ? date.getFullYear() + "年" : "") +
  (date.getMonth() + 1) +
  "月" +
  date.getDate() +
  "日 " +
  pad(date.getHours()) +
  ":" +
  pad(date.getMinutes());
const timelineFieldLabels: Record<string, string> = {
  title: "タイトル",
  description: "説明",
  deadline: "期限",
  priority: "優先度",
  status: "状態",
  assignee: "担当者",
  tags: "タグ",
  reason: "否認理由",
};
function timelineDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDeadline(date, true);
}
function timelineValue(field: string, value: string | null) {
  switch (field) {
    case "status":
      return value
        ? ((statusLabels as Record<string, string>)[value] ?? value)
        : "";
    case "priority":
      return value
        ? ((priorityLabels as Record<string, string>)[value] ?? value)
        : "";
    case "deadline":
      return value ? timelineDate(value) : noDeadlineLabel;
    case "assignee":
      return value ? "「" + value + "」" : assigneeNoneLabel;
    default:
      return "「" + (value ?? "") + "」";
  }
}
function timelineLine(
  userName: string | null,
  kind: string,
  field: string | null,
  before: string | null,
  after: string | null,
) {
  const actor = userName ?? timelineCopy.memoFallback;
  if (kind === "todo.created") return actor + "がTODOを作成しました";
  if (kind === "todo.deleted") return actor + "がTODOを削除しました";
  if (kind === "todo.restored") return actor + "がTODOを元に戻しました";
  if (kind === "approval.approved") return actor + "が申請を承認しました";
  if (kind === "approval.rejected")
    return (
      actor + "が申請を否認しました" + (after ? "（理由: " + after + "）" : "")
    );
  if (kind !== "todo.updated" || !field) return "";
  const label = timelineFieldLabels[field];
  if (!label) return "";
  return (
    actor +
    "が" +
    label +
    "を" +
    timelineValue(field, before) +
    "から" +
    timelineValue(field, after) +
    "に変更しました"
  );
}
export const messages = {
  locale: "ja",
  app: {
    title: "トドTODO",
    description: "トドのようにTODOを遂行できるTODOウェブアプリ",
    skipToMain: "メインコンテンツへ",
    navigation: "TODOの表示",
    currentTime: "現在の日時",
  },
  board: {
    loading: "読み込み中…",
  },
  common: {
    close: "閉じる",
    cancel: "キャンセル",
    undo: "元に戻す",
    retry: "再試行",
    closeNotification: "通知を閉じる",
    required: "必須",
    optional: "任意",
    characters: (current: number, max: number) => current + " / " + max,
  },
  status: statusLabels,
  priority: priorityLabels,
  filters: {
    heading: {
      all: "すべてのTODO",
      active: "未完了",
      overdue: "期限超過",
      today: "今日が期限",
      doing: "進行中",
      done: "完了したTODO",
    },
    navigation: {
      all: "すべてのTODO",
      active: "未完了",
      overdue: "期限超過",
      today: "今日が期限",
      doing: "進行中",
      done: "完了",
    },
    showAll: "すべてのTODOを見る",
    empty: "TODOなし",
    noResults: "検索結果なし",
    assignment: {
      any: "すべてのメンバー",
      none: assigneeNoneLabel,
    },
  },
  search: {
    label: "要素を検索する",
    clear: "検索をクリアする",
    sort: "並べ替え",
    assignee: "担当者",
    deadlineOrder: "期限が近い順",
    priorityOrder: "優先度が高い順",
  },
  layout: {
    label: "一覧の表示形式",
    cards: "カード",
    compact: "リスト",
  },
  tags: {
    label: "タグ",
    input: "タグを入力してEnterで追加",
    removeLabel: (tag: string) => tag + "を削除",
    suggestionLabel: "タグの候補",
    max: (count: number) => count + " / 5",
    errorCount: "タグは5個までです。",
    errorLength: "タグは20文字以内で入力してください。",
    requestTag: REQUEST_TAG_LABEL,
  },
  approval: {
    label: "申請",
    pending: "承認待ち",
    approved: "承認済み",
    rejected: "否認済み",
    approve: "承認する",
    reject: "否認する",
    approveConfirmTitle: "この申請を承認しますか？",
    approveConfirmDescription: (title: string) =>
      "「" + title + "」を承認済みにします。",
    reasonLabel: "否認理由",
    reasonPlaceholder: "否認する理由を入力してください",
    reasonRequired: "否認理由を入力してください。",
    reasonHeading: "否認理由",
    submitted: "申請を承認しました",
    rejectedSubmitted: "申請を否認しました",
    reasonCount: (current: number, max: number) => current + " / " + max,
  },
  notifications: {
    title: "通知",
    openLabel: (count: number) =>
      "通知" + (count ? "（未読 " + count + "件）" : ""),
    empty: "通知はまだありません",
    mention: (name: string | null) => (name ?? "誰か") + "がメンションしました",
    assigned: (name: string | null) =>
      (name ?? "誰か") + "が新しいTODOを作りました",
    approved: (name: string | null) =>
      (name ?? "誰か") + "が申請を承認しました",
    rejected: (name: string | null) =>
      (name ?? "誰か") + "が申請を否認しました",
    self: "自分",
  },
  completion: {
    announced: (title: string) => "「" + title + "」を完了に移動しました",
    skip: "演出をスキップする",
    title: "タスクが完了しました",
    allDone: "素晴らしい！すべて消化できました🎉",
    oneLeft: "残るは1個です🔥",
    keepGoing: "この調子で頑張りましょう🌊",
  },
  todo: {
    create: "TODOを作る",
    createAction: "TODOを作る",
    edit: "TODOを編集",
    delete: "TODOを削除",
    save: "変更を保存",
    title: "タイトル",
    description: "説明",
    deadline: "期限",
    noDeadline: noDeadlineLabel,
    omitDeadline: "期限を設定しない",
    priority: "優先度",
    state: "状態",
    assignee: "担当者",
    assigneeUnknown: "不明なメンバー",
    overdue: "期限超過",
    nextDeadline: "直近の期限",
    today: "今日",
    details: "TODOの内容",
    open: "詳細を開く",
    openLabel: (title: string) => title + "の詳細を開く",
    noteCount: (count: number) => count + "件のメモ",
    priorityLabel: (label: string) => "優先度 " + label,
    created: "TODOを作成しました",
    saved: "変更を保存しました",
    deleted: "TODOを削除しました",
    restored: "TODOを元に戻しました",
    stateUpdated: "状態を更新しました",
    deleteTitle: "このTODOを削除しますか？",
    deleteDescription: (title: string, notes: number) =>
      "「" +
      title +
      "」と、" +
      notes +
      "件のメモを削除します。入力中のメモも破棄されます。",
    titleRequired: "タイトルを入力してください。",
    invalidDeadline: "有効な期限日時を入力してください。",
    noDeadlineConfirm: {
      createTitle: "期限なしで作成しますか？",
      saveTitle: "期限なしで保存しますか？",
      description:
        "期限なしのTODOは期限順の最後に表示されます。期限はあとから設定できます。",
      create: "期限なしで作成",
      save: "期限なしで保存",
      set: "期限を設定する",
    },
  },
  subtask: {
    heading: "サブタスク",
    add: "サブタスクを追加",
    edit: "サブタスクを編集",
    save: "サブタスクを保存",
    delete: "サブタスクを削除",
    title: "サブタスクのタイトル",
    deadline: "期限",
    noDeadline: "期限を設定しない",
    priority: "優先度",
    status: "完了状態",
    memo: "サブタスクのメモ",
    memoInput: "サブタスクのメモを入力",
    memoSend: "メモを追加",
    memoCount: (count: number) => count + "件のメモ",
    count: (done: number, total: number) => "サブタスク " + done + "/" + total,
    empty: "サブタスクなし",
    toggleLabel: (title: string) => title + "の完了状態を切り替える",
    editLabel: (title: string) => title + "を編集",
    deleteLabel: (title: string) => title + "を削除",
    created: "サブタスクを追加しました",
    saved: "サブタスクを保存しました",
    deleted: "サブタスクを削除しました",
    stateUpdated: "サブタスクの完了状態を更新しました",
    memoSent: "サブタスクのメモを追加しました",
    deleteTitle: "このサブタスクを削除しますか？",
    deleteDescription: (title: string, memos: number) =>
      "「" +
      title +
      "」と、" +
      memos +
      "件のメモを削除します。元に戻せません。",
    titleRequired: "サブタスクのタイトルを入力してください。",
    invalidDeadline: "有効な期限日時を入力してください。",
    noDeadlineConfirm: {
      title: "期限なしで保存しますか？",
      description: "期限なしのサブタスクは、あとから期限を設定できます。",
      save: "期限なしで保存",
      set: "期限を設定する",
    },
  },
  discard: {
    title: "入力中の内容を破棄しますか？",
    description: "保存していない入力内容が失われます。",
    close: "破棄して閉じる",
    detail: "破棄して詳細に戻る",
    edit: "破棄して編集する",
    keep: "入力を続ける",
  },
  chat: {
    title: "メモ",
    history: "メモの履歴",
    self: "自分",
    input: "メモを入力",
    send: "送信",
    sendShortcut: "送信（Ctrl+Enter / ⌘+Enter）",
    sent: "送信しました",
    revealing: "メモを表示中",
  },
  activity: {
    ...timelineCopy,
    line: timelineLine,
  },
  manage: {
    title: "リスト管理",
    listTitleLabel: "リストのタイトル",
    save: "保存",
    membersTitle: "メンバー",
    memberNameLabel: (name: string) => name + "の名前",
    assignedCount: (count: number) => count + "件担当",
    joinedAt: "参加日",
    you: "あなた",
    removeMember: "削除",
    removeMemberTitle: (name: string) => "「" + name + "」を削除しますか？",
    removeMemberDescription: (name: string) =>
      "「" +
      name +
      "」をリストから削除します。担当中のTODOは未割り当てになります。",
    removeSelfHint: "自分自身を削除すると、この画面に戻れなくなります。",
    deleteList: "リストを削除",
    deleteListTitle: "リストを削除しますか？",
    deleteListWarning:
      "リストを削除すると、このリストのすべてのTODO・メモ・変更履歴が完全に削除されます。元に戻せません。",
    deleteListAction: "リストを削除する",
    deleteListConfirmTitle: "本当にリストを削除しますか？",
    deleteListConfirmDescription:
      "すべてのタスク・メモ・履歴が削除されます。取り消せません。",
    deleteListConfirm: "削除する",
    dangerTitle: "リストの削除",
    shareLabel: "共有URL",
    copyShare: "共有URLをコピー",
    copied: "共有URLをコピーしました",
    dataTitle: "データ",
    dataExport: "データの書き出し",
  },
  login: {
    heading: "共有TODOへ参加",
    joinTab: "既存リストに参加",
    joinToken: "共有トークン",
    joinName: "あなたの名前",
    createTab: "新しいリストを作る",
    createListTitle: "リストのタイトル",
    createListName: "あなたの名前",
    joinAction: "参加",
    createAction: "作成",
    creating: "作成中…",
    joining: "参加中…",
    invalidToken: "共有トークンが正しくありません。",
    duplicatedName:
      "同じ名前のメンバーがいます。異なる名前を入力してください。",
  },
  calendar: {
    register: "Googleカレンダーに登録する",
    openLabel: "Googleカレンダーに登録（別タブで開く）",
    webOpen: "ブラウザー版で開く",
    webOpenLabel: "Googleカレンダーのブラウザー版で開く（別タブで開く）",
    deadlineMissing: "期限未設定",
    setDeadline: "期限を設定",
    eventTitle: (title: string) => "【締切】" + title,
  },
  data: {
    title: "データの書き出し",
    location: "保存先：サーバー",
    storageNotice:
      "リストのデータはサーバー上に保存され、全メンバーと共有されます。",
    cloudSummary: (title: string, members: number) =>
      "「" + title + "」・メンバー " + members + "人",
    summary: (todos: number, notes: number) =>
      "TODO " + todos + "件・メモ " + notes + "件",
    exportTitle: "バックアップを書き出す",
    export: "書き出す",
    exportStarted: "バックアップの書き出しを開始しました",
    exportFilename: (date: string) => "todo-cloud-" + date + ".json",
    backupFilename: (date: string) => "todo-" + date + ".json",
    restoreTitle: "バックアップから復元する",
    method: "復元方法",
    restore: "復元する",
    fileLabel: "復元するJSONファイル",
    chooseFile: "ファイルを選ぶ",
    loading: "読み込み中…",
    modes: {
      replace: {
        label: "完全上書き",
        description: "現在のTODOとメモを、ファイルの内容に置き換えます。",
        confirmation: "現在のTODOとメモを置き換えます。元に戻せません。",
      },
      merge: {
        label: "更新＋新規追加",
        description:
          "同じIDは読み込んだ値で更新し、メモを時系列に統合。新しいIDも追加します。",
        confirmation:
          "同じIDの項目は読み込んだ値を採用します。メモは日時順に統合し、同じメモIDは読み込んだ内容を採用します。",
      },
      add: {
        label: "新規追加",
        description:
          "新しいIDだけ追加します。同じIDのTODOとメモは変更しません。",
        confirmation: "既存のTODOとメモは変更しません。",
      },
    },
    restoreConfirmTitle: (mode: string) => mode + "で復元しますか？",
    restoreConfirmDescription: (
      added: number,
      updated: number,
      removed: number,
      detail: string,
    ) =>
      "追加 " +
      added +
      "件、更新 " +
      updated +
      "件、削除 " +
      removed +
      "件。" +
      detail,
    restored: (added: number, updated: number, removed: number) =>
      "復元しました（追加 " +
      added +
      "件・更新 " +
      updated +
      "件・削除 " +
      removed +
      "件）",
    preview: {
      added: "追加",
      updated: "更新",
      removed: "削除",
      total: "復元後",
      unchanged: "変更対象がありません。",
    },
    replaceOnly: "保存データを読み込めないため、完全上書きのみ利用できます。",
    bulk: {
      title: "TODOの一括削除",
      target: "削除対象",
      done: "完了済みのTODO",
      all: "すべてのTODO",
      actions: {
        done: "完了済みのTODOを削除する",
        all: "すべてのTODOを削除する",
      },
      confirm: "削除する",
      cancel: "キャンセルする",
      todoCount: (count: number) => "TODO " + count + "件",
      noteCount: (count: number) => "メモ " + count + "件",
      notice: "関連するメモも削除されます。この操作は取り消せません。",
      doneTitle: "完了済みのTODOを削除しますか？",
      allTitle: "すべてのTODOを削除しますか？",
      confirmation: (todos: number, notes: number) =>
        "TODO " +
        todos +
        "件とメモ " +
        notes +
        "件を削除します。元に戻せません。必要なデータは先に書き出してください。",
      deleted: (count: number) => "TODO " + count + "件を削除しました",
    },
    recovery: {
      title: "読み込めないデータを初期化",
      description:
        "先に書き出しを行ってください。初期化すると、現在の保存データは削除されます。",
      action: "保存データを初期化",
      confirmTitle: "保存データを初期化しますか？",
      confirmDescription:
        "この操作で保存されているTODOとメモをすべて削除します。元に戻せません。",
      confirm: "初期化する",
      done: "保存データを初期化しました",
    },
  },
  errors: {
    api: {
      general: "通信エラーが発生しました。再試行してください。",
    },
    invalidState: "共有データを読み込めませんでした",
  },
  dateTime: {
    headerDate: (d: Date) =>
      d.getFullYear() +
      "年" +
      pad(d.getMonth() + 1) +
      "月" +
      pad(d.getDate()) +
      "日",
    headerTime: (d: Date) =>
      pad(d.getHours()) +
      "時" +
      pad(d.getMinutes()) +
      "分" +
      pad(d.getSeconds()) +
      "秒",
    clock: (d: Date) =>
      d.getFullYear() +
      "年" +
      pad(d.getMonth() + 1) +
      "月" +
      pad(d.getDate()) +
      "日 " +
      pad(d.getHours()) +
      "時" +
      pad(d.getMinutes()) +
      "分" +
      pad(d.getSeconds()) +
      "秒",
    deadline: (d: Date, withYear: boolean) => formatDeadline(d, withYear),
  },
} as const;
