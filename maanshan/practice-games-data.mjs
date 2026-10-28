// school74 practice games: 小老師找錯 and 讀音小偵探, one of each per poem.
// Grades 1-2 get the short listening versions; grades 3-6 find the misread character
// or sort words and state the rule. Every clip is pre-recorded under
// media/practice-games-20261029/<id>.mp3 (scripts/build-practice-game-audio.cjs);
// `spoken` is what the clip says, book tones, with 3+3 sandhi applied on synthesis.

// Pinyin written with the book tones; a wrong reading is the one the 書童 says.
const s = text => text.split(' ');

const SPOT = {
  // Grade 1 (聲調), grade 2 (韻母): 書童讀一個詞, 讀對了還是讀錯了?
  'yong-e': {mode: 'judge', rounds: [
    {text: '綠水', right: s('lǜ shuǐ')},
    {text: '白毛', right: s('bái máo'), said: s('bǎi máo'), wrong: 0},
    {text: '清波', right: s('qīng bō')},
    {text: '紅掌', right: s('hóng zhǎng'), said: s('hōng zhǎng'), wrong: 0}
  ]},
  'yong-xue': {mode: 'judge', rounds: [
    {text: '一片', right: s('yí piàn')},
    {text: '梅花', right: s('méi huā'), said: s('měi huā'), wrong: 0},
    {text: '飛入', right: s('fēi rù')},
    {text: '九十片', right: s('jiǔ shí piàn'), said: s('jiū shí piàn'), wrong: 0}
  ]},
  'zeng-wang-lun': {mode: 'judge', rounds: [
    {text: '乘舟', right: s('chéng zhōu')},
    {text: '歌聲', right: s('gē shēng'), said: s('gē shēn'), wrong: 1},
    {text: '汪倫', right: s('wāng lún')},
    {text: '送我情', right: s('sòng wǒ qíng'), said: s('sòng wǒ qín'), wrong: 2}
  ]},
  'hua-ji': {mode: 'judge', rounds: [
    {text: '紅冠', right: s('hóng guān')},
    {text: '平生', right: s('píng shēng'), said: s('pín shēng'), wrong: 0},
    {text: '雪白', right: s('xuě bái')},
    {text: '走將來', right: s('zǒu jiāng lái'), said: s('zǒu jiān lái'), wrong: 1}
  ]},
  // Grades 3-6: 書童讀一句, 一個字讀錯了. 點出來, 再選對的讀音.
  'ti-xi-lin-bi': {mode: 'find', rounds: [
    {text: '橫看成嶺側成峯', right: s('héng kàn chéng lǐng cè chéng fēng'), wrong: 2, said: 'céng', options: ['chéng', 'céng']},
    {text: '不識廬山真面目', right: s('bù shí lú shān zhēn miàn mù'), wrong: 1, said: 'sí', options: ['sí', 'shí']},
    {text: '只緣身在此山中', right: s('zhǐ yuán shēn zài cǐ shān zhōng'), wrong: 6, said: 'zōng', options: ['zhōng', 'zōng']}
  ]},
  'qi-bu-shi': {mode: 'find', rounds: [
    {text: '煮豆持作羹', right: s('zhǔ dòu chí zuò gēng'), wrong: 0, said: 'zǔ', options: ['zǔ', 'zhǔ']},
    {text: '萁在釜下燃', right: s('qí zài fǔ xià rán'), wrong: 4, said: 'lán', options: ['rán', 'lán']},
    {text: '本是同根生', right: s('běn shì tóng gēn shēng'), wrong: 4, said: 'sēng', options: ['sēng', 'shēng']}
  ]},
  'bo-chuan-gua-zhou': {mode: 'find', rounds: [
    {text: '京口瓜洲一水間', right: s('jīng kǒu guā zhōu yì shuǐ jiān'), wrong: 6, said: 'jiāng', options: ['jiān', 'jiāng']},
    {text: '春風又綠江南岸', right: s('chūn fēng yòu lǜ jiāng nán àn'), wrong: 1, said: 'fēn', options: ['fēn', 'fēng']},
    {text: '明月何時照我還', right: s('míng yuè hé shí zhào wǒ huán'), wrong: 0, said: 'mín', options: ['míng', 'mín']}
  ]},
  'jue-ju': {mode: 'find', rounds: [
    {text: '兩個黃鸝鳴翠柳', right: s('liǎng gè huáng lí míng cuì liǔ'), wrong: 4, said: 'mín', options: ['mín', 'míng']},
    {text: '一行白鷺上青天', right: s('yì háng bái lù shàng qīng tiān'), wrong: 5, said: 'qīn', options: ['qīng', 'qīn']},
    {text: '門泊東吳萬里船', right: s('mén bó dōng wú wàn lǐ chuán'), wrong: 6, said: 'chuáng', options: ['chuáng', 'chuán']}
  ]},
  'gui-yuan-tian-ju': {mode: 'find', rounds: [
    {text: '種豆南山下', right: s('zhòng dòu nán shān xià'), wrong: 2, said: 'lán', options: ['lán', 'nán', 'láng']},
    {text: '草盛豆苗稀', right: s('cǎo shèng dòu miáo xī'), wrong: 1, said: 'sèng', options: ['shèng', 'sèng', 'xìng']},
    {text: '帶月荷鋤歸', right: s('dài yuè hè chú guī'), wrong: 3, said: 'cú', options: ['qú', 'cú', 'chú']}
  ]},
  'zheng-ren-mai-lu': {mode: 'find', rounds: [
    {text: '鄭人有且置履者', right: s('zhèng rén yǒu qiě zhì lǚ zhě'), wrong: 0, said: 'zèng', options: ['zèng', 'jìng', 'zhèng']},
    {text: '先自度其足', right: s('xiān zì duó qí zú'), wrong: 4, said: 'zhú', options: ['zú', 'zhú', 'jú']},
    {text: '寧信度，無自信也', right: s('nìng xìn dù wú zì xìn yě'), wrong: 0, said: 'lìng', options: ['lìng', 'yìng', 'nìng']}
  ]},
  'zao-chun': {mode: 'find', rounds: [
    {text: '天街小雨潤如酥', right: s('tiān jiē xiǎo yǔ rùn rú sū'), wrong: 4, said: 'yùn', options: ['yùn', 'rùn', 'lùn']},
    {text: '草色遙看近卻無', right: s('cǎo sè yáo kàn jìn què wú'), wrong: 1, said: 'shè', options: ['sè', 'shè', 'cè']},
    {text: '最是一年春好處', right: s('zuì shì yì nián chūn hǎo chù'), wrong: 1, said: 'sì', options: ['xì', 'sì', 'shì']}
  ]},
  'ke-zhi': {mode: 'find', rounds: [
    {text: '但見群鷗日日來', right: s('dàn jiàn qún ōu rì rì lái'), wrong: 4, said: 'yì', options: ['rì', 'yì', 'lì']},
    {text: '花徑不曾緣客掃', right: s('huā jìng bù céng yuán kè sǎo'), wrong: 6, said: 'shǎo', options: ['shǎo', 'xiǎo', 'sǎo']},
    {text: '隔籬呼取盡餘杯', right: s('gé lí hū qǔ jìn yú bēi'), wrong: 1, said: 'ní', options: ['yí', 'lí', 'ní']}
  ]}
};

const YI_RULE = '「一」後面是第四聲，讀 yí；後面是第一、二、三聲，讀 yì。數數時單獨讀 yī。';
const BU_RULE = '「不」後面是第四聲，讀 bú；其他時候讀 bù。';
const SANDHI_RULE = '兩個第三聲連在一起，前一個字讀成第二聲。拼音照樣寫第三聲。';
const YI = {question: '放進 yí 籃子的詞，「一」後面的字是第幾聲？', options: ['第一聲', '第四聲', '第三聲'], answer: 1};
const BU = {question: '放進 bú 籃子的詞，「不」後面的字是第幾聲？', options: ['第二聲', '第三聲', '第四聲'], answer: 2};
const SANDHI = {question: '甚麼時候，前一個字要變成第二聲？', options: ['後面是第四聲', '兩個第三聲連在一起', '後面是第一聲'], answer: 1};
const YI_BASKETS = [{id: 'yi2', label: 'yí'}, {id: 'yi4', label: 'yì'}];
const BU_BASKETS = [{id: 'bu2', label: 'bú'}, {id: 'bu4', label: 'bù'}];
const SANDHI_BASKETS = [{id: 'change', label: '前一個字變調'}, {id: 'keep', label: '不用變'}];

const RULE = {
  // Grades 1-2: 聽兩個讀音, 哪個是對的? `other` is the reading that forgets the change.
  'yong-e': {mode: 'pick', rule: YI_RULE, rounds: [
    {text: '一隻鵝', right: s('yì zhī é'), other: s('yī zhī é'), rightFirst: false},
    {text: '一個', right: s('yí gè'), other: s('yī gè'), rightFirst: true},
    {text: '一條魚', right: s('yì tiáo yú'), other: s('yí tiáo yú'), rightFirst: false}
  ]},
  'yong-xue': {mode: 'pick', rule: '「一」「不」後面是第四聲，就讀第二聲：一片 yí piàn，不見 bú jiàn。', rounds: [
    {text: '一片', right: s('yí piàn'), other: s('yī piàn'), rightFirst: true},
    {text: '不見', right: s('bú jiàn'), other: s('bù jiàn'), rightFirst: false},
    {text: '一朵花', right: s('yì duǒ huā'), other: s('yí duǒ huā'), rightFirst: true}
  ]},
  'zeng-wang-lun': {mode: 'pick', rule: BU_RULE, rounds: [
    {text: '不是', right: s('bú shì'), other: s('bù shì'), rightFirst: false},
    {text: '不及', right: s('bù jí'), other: s('bú jí'), rightFirst: true},
    {text: '不要', right: s('bú yào'), other: s('bù yào'), rightFirst: false}
  ]},
  'hua-ji': {mode: 'pick', rule: BU_RULE, rounds: [
    {text: '不用', right: s('bú yòng'), other: s('bù yòng'), rightFirst: true},
    {text: '不敢', right: s('bù gǎn'), other: s('bú gǎn'), rightFirst: false},
    {text: '一叫', right: s('yí jiào'), other: s('yī jiào'), rightFirst: true}
  ]},
  // Grades 3-6: 聽詞卡, 放進籃子, 說出規律, 再用到新詞上.
  'ti-xi-lin-bi': {mode: 'sort', rule: BU_RULE, baskets: BU_BASKETS, ...BU, cards: [
    {text: '不同', right: s('bù tóng'), basket: 'bu4'},
    {text: '不見', right: s('bú jiàn'), basket: 'bu2'},
    {text: '不好', right: s('bù hǎo'), basket: 'bu4'},
    {text: '不是', right: s('bú shì'), basket: 'bu2'}
  ], transfer: {text: '不怕', right: s('bú pà'), options: ['bú', 'bù'], answer: 0}},
  'qi-bu-shi': {mode: 'sort', rule: YI_RULE, baskets: YI_BASKETS, ...YI, cards: [
    {text: '一步', right: s('yí bù'), basket: 'yi2'},
    {text: '一根', right: s('yì gēn'), basket: 'yi4'},
    {text: '一首', right: s('yì shǒu'), basket: 'yi4'},
    {text: '一次', right: s('yí cì'), basket: 'yi2'}
  ], transfer: {text: '一半', right: s('yí bàn'), options: ['yì', 'yí'], answer: 1}},
  'bo-chuan-gua-zhou': {mode: 'sort', rule: YI_RULE, baskets: YI_BASKETS, ...YI, cards: [
    {text: '一水', right: s('yì shuǐ'), basket: 'yi4'},
    {text: '一個', right: s('yí gè'), basket: 'yi2'},
    {text: '一年', right: s('yì nián'), basket: 'yi4'},
    {text: '一路', right: s('yí lù'), basket: 'yi2'}
  ], transfer: {text: '一句', right: s('yí jù'), options: ['yí', 'yì'], answer: 0}},
  'jue-ju': {mode: 'sort', rule: YI_RULE, baskets: YI_BASKETS, ...YI, cards: [
    {text: '一片', right: s('yí piàn'), basket: 'yi2'},
    {text: '一行', right: s('yì háng'), basket: 'yi4'},
    {text: '一下', right: s('yí xià'), basket: 'yi2'},
    {text: '一隻', right: s('yì zhī'), basket: 'yi4'}
  ], transfer: {text: '一夜', right: s('yí yè'), options: ['yì', 'yí'], answer: 1}},
  'gui-yuan-tian-ju': {mode: 'sort', rule: SANDHI_RULE, baskets: SANDHI_BASKETS, ...SANDHI, cards: [
    {text: '小草', right: s('xiǎo cǎo'), basket: 'change'},
    {text: '草盛', right: s('cǎo shèng'), basket: 'keep'},
    {text: '雨水', right: s('yǔ shuǐ'), basket: 'change'},
    {text: '南山', right: s('nán shān'), basket: 'keep'}
  ], transfer: {text: '你好', right: s('nǐ hǎo'), prompt: '「你」聽起來像第幾聲？', options: ['第二聲', '第三聲'], answer: 0}},
  'zheng-ren-mai-lu': {mode: 'sort', rule: SANDHI_RULE, baskets: SANDHI_BASKETS, ...SANDHI, cards: [
    {text: '鄭人', right: s('zhèng rén'), basket: 'keep'},
    {text: '買履', right: s('mǎi lǚ'), basket: 'change'},
    {text: '取之', right: s('qǔ zhī'), basket: 'keep'},
    {text: '有且', right: s('yǒu qiě'), basket: 'change'}
  ], transfer: {text: '洗手', right: s('xǐ shǒu'), prompt: '「洗」聽起來像第幾聲？', options: ['第三聲', '第二聲'], answer: 1}},
  'zao-chun': {mode: 'sort', rule: SANDHI_RULE, baskets: SANDHI_BASKETS, ...SANDHI, cards: [
    {text: '小雨', right: s('xiǎo yǔ'), basket: 'change'},
    {text: '好處', right: s('hǎo chù'), basket: 'keep'},
    {text: '柳滿', right: s('liǔ mǎn'), basket: 'change'},
    {text: '春好', right: s('chūn hǎo'), basket: 'keep'}
  ], transfer: {text: '雨傘', right: s('yǔ sǎn'), prompt: '「雨」聽起來像第幾聲？', options: ['第二聲', '第三聲'], answer: 0}},
  'ke-zhi': {mode: 'sort', rule: SANDHI_RULE, baskets: SANDHI_BASKETS, ...SANDHI, cards: [
    {text: '春水', right: s('chūn shuǐ'), basket: 'keep'},
    {text: '水果', right: s('shuǐ guǒ'), basket: 'change'},
    {text: '鄰翁', right: s('lín wēng'), basket: 'keep'},
    {text: '洗手', right: s('xǐ shǒu'), basket: 'change'}
  ], transfer: {text: '老虎', right: s('lǎo hǔ'), prompt: '「老」聽起來像第幾聲？', options: ['第三聲', '第二聲'], answer: 1}}
};

// What a clip says. Wrong readings replace one syllable of the book reading.
function clipsOf(slug) {
  const clips = [], spot = SPOT[slug], rule = RULE[slug];
  spot.rounds.forEach((round, i) => {
    const said = spot.mode === 'find' ? round.right.map((value, at) => at === round.wrong ? round.said : value) : round.said || round.right;
    clips.push({id: `${slug}-spot-${i}-said`, text: round.text, spoken: said});
    if (said.join(' ') !== round.right.join(' ')) clips.push({id: `${slug}-spot-${i}-right`, text: round.text, spoken: round.right});
  });
  if (rule.mode === 'pick') rule.rounds.forEach((round, i) => {
    clips.push({id: `${slug}-rule-${i}-right`, text: round.text, spoken: round.right});
    clips.push({id: `${slug}-rule-${i}-other`, text: round.text, spoken: round.other});
  });
  else {
    rule.cards.forEach((card, i) => clips.push({id: `${slug}-rule-${i}-card`, text: card.text, spoken: card.right}));
    clips.push({id: `${slug}-rule-transfer`, text: rule.transfer.text, spoken: rule.transfer.right});
  }
  return clips;
}

export const PRACTICE_GAMES = Object.freeze(Object.fromEntries(Object.keys(SPOT).map(slug => [slug, Object.freeze({spot: SPOT[slug], rule: RULE[slug]})])));
export const PRACTICE_GAME_CLIPS = Object.freeze(Object.keys(SPOT).flatMap(clipsOf));
// The reading a clip is synthesised with: numbered pinyin, 3+3 sandhi on the written tones
// (一 and 不 are already written changed). Punctuation ends a run.
const MARKS = ['āēīōūǖ', 'áéíóúǘ', 'ǎěǐǒǔǚ', 'àèìòùǜ'];
const numbered = value => value.normalize('NFD').replace(/[\u0304\u0301\u030c\u0300]/g, '').normalize('NFC').replace(/ü/g, 'v')
  + ((MARKS.findIndex(marks => Array.from(value).some(char => marks.includes(char))) + 1) || 5);
export function clipMarkup(id) {
  const clip = PRACTICE_GAME_CLIPS.find(value => value.id === id);
  if (!clip) return null;
  let at = 0;
  const units = Array.from(clip.text, char => /\p{Script=Han}/u.test(char) ? {char, ph: numbered(clip.spoken[at++])} : {char});
  return '<speak>' + units.map((unit, i) => !unit.ph ? unit.char
    : `<phoneme alphabet="py" ph="${unit.ph.endsWith('3') && units[i + 1]?.ph?.endsWith('3') ? unit.ph.slice(0, -1) + '2' : unit.ph}">${unit.char}</phoneme>`).join('') + '</speak>';
}
export const clipAudio = id => {
  const clip = PRACTICE_GAME_CLIPS.find(value => value.id === id);
  return clip ? {clip: clip.id, text: clip.text, spoken: [...clip.spoken]} : null;
};
