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
      overdue: "期限超過",
      active: "未完了",
      today: "今日が期限",
      doing: "進行中",
      done: "完了したTODO",
    },
    navigation: {
      all: "すべてのTODO",
      overdue: "期限超過",
      active: "未完了",
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
    label: "要素を検索",
    clear: "検索をクリア",
    sort: "並べ替え",
    assignee: "担当者",
    deadlineOrder: "期限が近い順",
    priorityOrder: "優先度が高い順",
  },
  layout: {
    label: "一覧の表示形式",
    cards: "カード",
    compact: "簡潔",
  },
  completion: {
    announced: (title: string) => "「" + title + "」を完了に移動しました",
    skip: "演出をスキップ",
    title: "タスクが完了しました",
    allDone: "🎉 素晴らしい！すべて消化できました",
    oneLeft: "🔥 残るは1個です！",
    keepGoing: "🌊 この調子で頑張りましょう",
  },
  todo: {
    create: "新しいTODO",
    createAction: "TODOを作成",
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
    register: "Googleカレンダーに登録",
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
