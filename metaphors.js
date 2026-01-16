// たとえて降水確率：例えデータ定義ファイル
//
// このファイルでは、降水確率を人間向けに表現するための
// さまざまな例え文や統計ネタを定義します。index.html の
// スクリプトより前に読み込むことで、グローバル変数として
// `FACTS`, `FACT_POOL`, `randomFact`, `metaphorDB` を提供します。

// 統計ネタ（まじめ用）
window.FACTS = {
  ENGLISH_PCT: 18.8,
  MOBILE_OWN_PCT: 82
};

// まじめモードで使用する統計ネタの関数群
window.FACT_POOL = [
  () => `英語を話す人が世界の約${window.FACTS.ENGLISH_PCT}%と言われるくらいの確率。少数派だけど、当たる日は当たります。`,
  () => `世界の約${window.FACTS.ENGLISH_PCT}%程度が英語を話す推計に近い水準。『起きる可能性が現実的にある』ゾーンです。`,
  () => `携帯電話を持っている人が世界で約${window.FACTS.MOBILE_OWN_PCT}%と言われるくらいの確率。かなり起こります。`,
  () => `世界で携帯を持つ人が約${window.FACTS.MOBILE_OWN_PCT}%という話に近い水準。『降る前提』で計画しましょう。`
];

// 統計ネタからランダムに1つ選んで返すヘルパー関数
window.randomFact = function() {
  const pool = window.FACT_POOL;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx]();
};

// 各モードごとに降水確率に対応する例え文のデータベース
window.metaphorDB = {
  // 真面目モード：ためになる統計ネタや解説を含む
  serious: [
    { min: 0,  max: 9,   texts: [
      "ほぼ降水の心配なし。運用上は『傘なし』で良い確度です。",
      "リスクは極小。外出計画は雨を無視してOKなレベルです。"
    ]},
    { min: 10, max: 29,  texts: [
      "低確率だけどゼロじゃない。保険として折りたたみ傘が合理的。",
      "小さな不確実性が残る日。予定が長いなら備えが効きます。"
    ]},
    { min: 30, max: 49,  texts: [
      () => window.randomFact(),
      () => window.randomFact()
    ]},
    { min: 50, max: 69,  texts: [
      "五分五分〜やや高め。意思決定としては『傘を持つ』が優勢。",
      "外れると損が大きい確率帯。傘携行が期待値的に得です。"
    ]},
    { min: 70, max: 89,  texts: [
      () => window.randomFact(),
      () => window.randomFact()
    ]},
    { min: 90, max: 100, texts: [
      "ほぼ確実。雨天として動線・荷物・服装を組むのが正解です。",
      "失敗許容が低いレベルで高確率。雨対策を標準装備に。"
    ]}
  ],

  // 雑学モード：日常会話のような軽い例え（各範囲に学問ベースのネタを拡充）
  trivia: [
    { min: 0,  max: 9,   texts: [
      "今日はまず降らないっしょ。傘は置いてOK。",
      "ほぼ安心。空、やる気ゼロです。",
      "世界でフランス語を話す人は約3.4％:contentReference[oaicite:0]{index=0}。今日の降雨もこのくらいレア。",
      "アラビア語話者も世界人口の3.4％:contentReference[oaicite:1]{index=1}。それと同程度の雨の確率です。",
      "ベンガル語を母語とする人も3.4％:contentReference[oaicite:2]{index=2}。雨雲に出会う確率も同じ程度。",
      "ウルドゥー語話者は約2.9％:contentReference[oaicite:3]{index=3}。今日の雨もこれくらい希少です。",
      "江戸時代の日本では侍が人口の5〜10％:contentReference[oaicite:4]{index=4}。雨雲もそれくらい稀少。",
      "左利きは人口の約10％:contentReference[oaicite:5]{index=5}。雨に降られる確率もこの程度。",
      "侍階級の人口比5〜10％:contentReference[oaicite:6]{index=6}は、今日の雨の希少さと同じ。"
    ]},
    { min: 10, max: 29,  texts: [
      "たぶん平気。でも折りたたみあると心が強い。",
      "一応ある。『一応』が一番やっかい。",
      "世界人口の約18.8％が英語を話します:contentReference[oaicite:7]{index=7}。雨の確率もそれくらい。",
      "標準中国語話者は13.8％:contentReference[oaicite:8]{index=8}。雨雲の割合もその程度かもしれません。",
      "ヒンディー語話者は7.5％:contentReference[oaicite:9]{index=9}。雨雲の可能性もそれに近い。",
      "スペイン語話者は6.9％:contentReference[oaicite:10]{index=10}で、フランス語と足すと10％超。雨もそのくらい。",
      "右利きは90％、左利きは10％:contentReference[oaicite:11]{index=11}。この区間の雨もその中間くらい。",
      "サハラ砂漠が地球の陸地の約8％:contentReference[oaicite:12]{index=12}を占めるように、雨もごく一部に限られます。"
    ]},
    { min: 30, max: 49,  texts: [
      "降るかも。外出長いなら傘を。",
      "微妙に怪しい。傘を持つか、強運を信じるか。",
      "アフリカ大陸は地球陸地の約20％:contentReference[oaicite:13]{index=13}。雨の可能性もそのくらい。",
      "江戸時代の農民層（80％）に対し町人や商人は20％程度:contentReference[oaicite:14]{index=14}。雨の確率もその程度。",
      "成人の体脂肪やタンパク質は体重の15〜20％とされます。雨の確率もそのくらい。",
      "世界の森林面積は陸地の約30％:contentReference[oaicite:15]{index=15}で、熱帯雨林はその半分程度。雨雲の割合も似ています。",
      "明治維新後の士族の人口は全体の20％未満。雨の確率も同じくらい。"
    ]},
    { min: 50, max: 69,  texts: [
      "半々以上。持っとこ。あとで自分を褒められる。",
      "傘なしはギャンブル寄り。",
      "太平洋は地球表面の約30〜33％を占めます:contentReference[oaicite:16]{index=16}。雨の確率もそのくらいの広がり。",
      "地球の森林は陸地の約30％を覆い:contentReference[oaicite:17]{index=17}、陸上生物の8割がそこに住む。雨の確率も30〜40％。",
      "地球表面の水は71％、陸地は29％:contentReference[oaicite:18]{index=18}。30〜40％の雨の確率はその中間です。",
      "江戸幕府への年貢上納分は30％程度とされます。雨の可能性もそのくらい。",
      "世界の淡水資源の約30％が地下水です。雨の確率もそれと同じくらい。"
    ]},
    { min: 70, max: 89,  texts: [
      "けっこう降りそう。傘はレギュラー入り。",
      "雨前提で動くとストレス減ります。",
      "世界人口の半分以上がバイリンガル:contentReference[oaicite:19]{index=19}。雨の確率も半々を超えます。",
      "2008年には世界人口の過半数が都市に住むようになりました:contentReference[oaicite:20]{index=20}。雨も都会の人々に影響。",
      "成人男性の体は約60％が水分:contentReference[oaicite:21]{index=21}。雨の確率もそれくらい高め。",
      "成人女性の体は55％前後が水分:contentReference[oaicite:22]{index=22}。雨の可能性はそれより少し高い60％。",
      "アジアは世界の陸地の約30％ですが人口の60％を抱えます:contentReference[oaicite:23]{index=23}。雨雲も人口密度に比例して広がります。"
    ]},
    { min: 90, max: 100, texts: [
      "ほぼ雨。傘は必須。",
      "今日は雨確定に近い。潔く備えよう。",
      "地球表面の約71％は水で覆われています:contentReference[oaicite:24]{index=24}。雨の確率70％超はその数字とほぼ同じ。",
      "世界の地震の約90％は環太平洋火山帯で起きています:contentReference[oaicite:25]{index=25}。雨の確率90％もほぼ確実。",
      "世界人口の90％は右利きで左利きは10％程度:contentReference[oaicite:26]{index=26}。雨の確率90％はその多さと同じくらい確実です。"
    ]}
  ],

  // お笑いモード：ユーモアや比喩を交えた遊び心あふれる文
  fun: [
    { min: 0,  max: 9,   texts: [
      "砂漠でスコールに当たるくらい。",
      "傘を持ったら逆に晴れる、あれです。"
    ]},
    { min: 10, max: 29,  texts: [
      "『一滴も降らない』とは言ってない、って顔してる。",
      "折りたたみ傘を持つと…降らない法則、発動候補。"
    ]},
    { min: 30, max: 49,  texts: [
      "フルスイングでフェアウェイをキープする確率。",
      "洗濯物を外に出した瞬間、空が反抗する確率。"
    ]},
    { min: 50, max: 69,  texts: [
      "コイントス。裏が出たらびしょ濡れ。",
      "『降ったら会社のせい』が通用する確率。"
    ]},
    { min: 70, max: 89,  texts: [
      "雨という名のイベント、だいたい開催。",
      "今日は空が“水分補給”してくる日。"
    ]},
    { min: 90, max: 100, texts: [
      "世界は今日、あなたを濡らしにきています。",
      "傘？ いや、もはや装備品です。"
    ]}
  ]
};

// 従来の normal キーは trivia（雑学）モードにエイリアスする（後方互換性のため）
window.metaphorDB.normal = window.metaphorDB.trivia;
