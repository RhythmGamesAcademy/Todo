// UI text and formatting live here. Replace this dictionary to add another locale.
const pad = (value: number) => String(value).padStart(2, "0");
export const messages = {
  locale: "ja",
  app: {
    title: "TODO",
    description: "TODOアプリ",
    skipToMain: "メインコンテンツへ",
    navigation: "TODOの表示",
    currentTime: "現在の日時",
  },
  common: {
    close: "閉じる",
    cancel: "キャンセル",
    undo: "元に戻す",
    closeNotification: "通知を閉じる",
    required: "必須",
    optional: "任意",
    characters: (current: number, max: number) => current + " / " + max,
    items: (count: number) => count + "件",
  },
  status: { todo: "未着手", doing: "進行中", done: "完了" },
  priority: { high: "高", medium: "中", low: "低" },
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
  },
  search: {
    label: "TODO・メモを検索",
    clear: "検索をクリア",
    sort: "並べ替え",
    deadlineOrder: "期限が近い順",
    priorityOrder: "優先度が高い順",
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
    noDeadline: "期限なし",
    omitDeadline: "期限を設定しない",
    priority: "優先度",
    state: "状態",
    overdue: "期限超過",
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
  },
  calendar: {
    register: "Googleカレンダーに登録",
    openLabel: "Googleカレンダーに登録（別タブで開く）",
    deadlineMissing: "期限未設定",
    setDeadline: "期限を設定",
    eventTitle: (title: string) => "【締切】" + title,
  },
  data: {
    title: "データの保存・復元",
    open: "データの保存・復元を開く",
    location: "保存先：このブラウザ",
    storageNotice:
      "ブラウザのサイトデータを削除すると、TODOとメモも消去されます。",
    summary: (todos: number, notes: number) =>
      "TODO " + todos + "件・メモ " + notes + "件",
    storageSize: (kib: string) => "保存量（概算）" + kib + " KiB",
    exportTitle: "バックアップを書き出す",
    export: "書き出す",
    exportStarted: "バックアップの書き出しを開始しました",
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
        label: "ないTODOだけ追加",
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
      action: "まとめて削除",
      notice: "メモも削除されます。元に戻せません。",
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
    invalidBackup: "対応するバックアップ形式ではありません。",
    invalidTodo: "TODOのデータが正しくありません。",
    invalidNote: "メモのデータが正しくありません。",
    tooManyTodos: "復元後のTODOは10,000件以内にしてください。",
    restore: "復元できません。",
    readFile: "ファイルを読み込めませんでした。",
    fileTooLarge: "10MB以下のJSONファイルを選択してください。",
    changedBeforeRestore:
      "確認中に保存データが更新されました。変更件数を確認し、もう一度実行してください。",
    changedBeforeDelete:
      "確認中に保存データが更新されました。削除対象を確認し、もう一度実行してください。",
    corruptStorage:
      "保存データを読み込めませんでした。元のデータは変更していません。「データの保存」から書き出し、または復元してください。",
    storageUnavailable:
      "ブラウザの保存領域を利用できません。設定でサイトデータの保存を許可してください。",
    save: "保存できませんでした。保存容量やブラウザの設定を確認してください。変更は保存されていません。",
  },
  dateTime: {
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
    deadline: (d: Date, withYear: boolean) =>
      (withYear ? d.getFullYear() + "年" : "") +
      (d.getMonth() + 1) +
      "月" +
      d.getDate() +
      "日 " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes()),
  },
} as const;
