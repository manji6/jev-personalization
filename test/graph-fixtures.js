export function mixedGraph() {
  return {
    version: 1,
    offer: "吸汗速乾ポロシャツをご案内",
    nodes: [
      {
        id: "url",
        kind: "url",
        source: "entry",
        field: "query",
        key: "cid",
        operator: "contains",
        value: "runner",
      },
      {
        id: "interest",
        kind: "jev",
        key: "interest",
        format: "guided",
        condition: "ポロシャツに関心がある",
      },
      {
        id: "comparison",
        kind: "jev",
        key: "comparison",
        format: "raw",
        instructions: "購入に向けて比較していますか？",
      },
      { id: "or", kind: "or" },
      { id: "and", kind: "and" },
      { id: "result", kind: "result" },
    ],
    edges: [
      { id: "a", from: "url", to: "or" },
      { id: "b", from: "interest", to: "or" },
      { id: "c", from: "or", to: "and" },
      { id: "d", from: "comparison", to: "and" },
      { id: "e", from: "and", to: "result" },
    ],
    layout: {},
  };
}
