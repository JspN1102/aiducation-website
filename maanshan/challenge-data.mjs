// Questions are assessment content, not a claim that an entire phonics lesson is covered.
// Render only prompt/options/cards/slot labels before submission. Audio text, targets,
// explanations and curriculum metadata must never become pre-answer captions or aria labels.
export const CHALLENGE_VERSION = 1;

const toneOptions = () => [
  {id: 'a', label: '第一聲', contour: 'level'},
  {id: 'b', label: '第二聲', contour: 'rising'},
  {id: 'c', label: '第三聲', contour: 'dipping'},
  {id: 'd', label: '第四聲', contour: 'falling'}
];
const options = (...labels) => labels.map((label, index) => ({id: String.fromCharCode(97 + index), label}));
const scene = (slug, number) => `media/${slug}/scene-${number}.webp`;

export const CHALLENGE_SETS = Object.freeze({
  'yong-e': {
    grade: 1,
    title: '清波小遊記',
    curriculum: {unit: 1, lesson: 1, focus: '學習四聲', sampled: ['第二聲', '第三聲'], notSampled: ['第一聲', '第四聲'], source: '概覽：一年級第一學段第一單元第一課；教材照片 1-1.2（第4頁）。'},
    items: [
      {id: 'g1-s1', type: 'sound', focus: '第二聲', prompt: '聽一聽，這個字是第幾聲？', audio: {char: '鵝', pinyin: 'é'}, options: toneOptions(), answerId: 'b', explanation: '「鵝」讀 é，是第二聲。聲音向上揚，像走上一個小斜坡。'},
      {id: 'g1-d1', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「白色」的「白」。', char: '白', pinyin: 'bái'}, target: {char: '白', pinyin: 'bái', accept: ['白']}, explanation: '白色的「白」。詩裏寫的是白色的羽毛。'},
      {id: 'g1-s2', type: 'sound', focus: '第三聲', prompt: '再聽一個字，把聲音送到合適的聲調小站。', audio: {char: '水', pinyin: 'shuǐ'}, options: toneOptions(), answerId: 'c', explanation: '「水」單獨讀 shuǐ，是第三聲。聲音先往下，再往上。'},
      {id: 'g1-d2', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「羽毛」的「毛」。', char: '毛', pinyin: 'máo'}, target: {char: '毛', pinyin: 'máo', accept: ['毛']}, explanation: '羽毛的「毛」。最後一筆豎彎鈎，把小尾巴寫出來。'},
      {id: 'g1-m1', type: 'match', prompt: '白鵝的世界有甚麼顏色？把色彩卡放到合適的位置。', modelSlug: 'yong-e', cards: [{id: 'a', label: '白色', color: '#fffdf6'}, {id: 'b', label: '紅色', color: '#c7594c'}, {id: 'c', label: '綠色', color: '#689781'}], slots: [{id: 'one', label: '腳掌', accepts: 'b'}, {id: 'two', label: '羽毛', accepts: 'a'}, {id: 'three', label: '水面', accepts: 'c'}], explanation: '白毛、紅掌、綠水，三種顏色讓白鵝游水的畫面鮮明起來。'}
    ]
  },
  'zeng-wang-lun': {
    grade: 2,
    title: '桃花潭的來信',
    curriculum: {unit: 2, lesson: 4, focus: 'ua、uo、uai、ui（uei）', sampled: ['ua', 'ui（uei）'], notSampled: ['uo', 'uai'], source: '概覽：二年級第一學段第二單元第四課；教材照片 2-4.3（第27頁）。uai 在詩正文沒有直接例字，在朗讀活動以「快」作拓展練習。'},
    items: [
      {id: 'g2-s1', type: 'sound', focus: 'ua', prompt: '「花」的韻母是哪一個？', audio: {char: '花', pinyin: 'huā'}, options: options('uo', 'ua', 'uai'), answerId: 'b', explanation: '「花」讀 huā，韻母是 ua。「火」的韻母才是 uo，聽起來不一樣。'},
      {id: 'g2-d1', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「汪倫」的「汪」。', char: '汪', pinyin: 'wāng'}, target: {char: '汪', pinyin: 'wāng', accept: ['汪']}, explanation: '汪倫的「汪」。左邊是三點水，別和日字旁的「旺」混淆。'},
      {id: 'g2-s2', type: 'sound', focus: 'ui（uei）', prompt: '「水」的韻母，在拼音中寫成甚麼？', audio: {char: '水', pinyin: 'shuǐ'}, options: options('iu', 'uai', 'ui'), answerId: 'c', explanation: '「水」讀 shuǐ。uei 跟聲母相拼時寫成 ui；iu 的先後次序不同。'},
      {id: 'g2-d2', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「汪倫」的「倫」。', char: '倫', pinyin: 'lún'}, target: {char: '倫', pinyin: 'lún', accept: ['倫', '伦']}, explanation: '汪倫的「倫」，左邊是單人旁；「輪」的部首和意思都不同。'},
      {id: 'g2-m1', type: 'sequence', prompt: '這首詩怎樣展開？把三張故事卡依次放好。', modelSlug: 'zeng-wang-lun', cards: [{id: 'a', label: '準備乘船離開', image: scene('zeng-wang-lun', 1)}, {id: 'b', label: '聽見岸邊的歌聲', image: scene('zeng-wang-lun', 2)}, {id: 'c', label: '用潭水比友情', image: scene('zeng-wang-lun', 4)}], slots: [{id: 'one', label: '先', accepts: 'a'}, {id: 'two', label: '接着', accepts: 'b'}, {id: 'three', label: '最後', accepts: 'c'}], explanation: '詩先寫乘舟將走，再寫忽然聽見踏歌聲，最後用深潭水襯托友情。這是詩意展開的順序。'}
    ]
  },
  'ti-xi-lin-bi': {
    grade: 3,
    title: '山中觀察日記',
    curriculum: {unit: 2, lesson: 4, focus: '複習聲母 g、k、h', sampled: ['g', 'k'], notSampled: ['h'], source: '概覽：三年級第一學段第二單元第四課；教材照片 3-4.1（第25頁）、3-4.2。'},
    items: [
      {id: 'g3-s1', type: 'sound', focus: 'g', prompt: '聽清楚開頭的聲音，應送到哪個聲母貨架？', audio: {char: '高', pinyin: 'gāo'}, options: options('h', 'k', 'g'), answerId: 'c', explanation: '「高」讀 gāo，聲母是 g。g 不送氣，k 送氣，讀 k 時氣流較強。'},
      {id: 'g3-d1', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「山嶺」的「嶺」。', char: '嶺', pinyin: 'lǐng'}, target: {char: '嶺', pinyin: 'lǐng', accept: ['嶺', '岭']}, explanation: '山嶺的「嶺」，有山字旁。橫着看，山脈綿延，像一道長長的山嶺。'},
      {id: 'g3-s2', type: 'sound', focus: 'k', prompt: '再聽一個字，這次開頭的聲母是哪個？', audio: {char: '看', pinyin: 'kàn'}, options: options('k', 'g', 'h'), answerId: 'a', explanation: '這裏的「看」讀 kàn，聲母是 k。把手放在嘴前讀一讀，能感到較明顯的氣流。'},
      {id: 'g3-d2', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「側面」的「側」。', char: '側', pinyin: 'cè'}, target: {char: '側', pinyin: 'cè', accept: ['側', '侧']}, explanation: '側面的「側」，左邊是單人旁。「側看」就是換到側面去看。'},
      {id: 'g3-m1', type: 'match', prompt: '同一座山，兩個角度。轉轉模型，把照片放到對應的觀察位置。', modelSlug: 'ti-xi-lin-bi', cards: [{id: 'a', label: '照片甲', image: 'media/challenges/ti-xi-lin-bi-horizontal.webp'}, {id: 'b', label: '照片乙', image: 'media/challenges/ti-xi-lin-bi-side.webp'}], slots: [{id: 'one', label: '側看', accepts: 'b'}, {id: 'two', label: '橫看', accepts: 'a'}], explanation: '橫看是連綿的山嶺，側看是高聳的山峯。變的是觀察角度，不是山真的變了形。'}
    ]
  },
  'bo-chuan-gua-zhou': {
    grade: 4,
    title: '月光寄往江南',
    curriculum: {unit: 2, lesson: 3, focus: '複習韻母 u、ua、uo', sampled: ['u', 'uo'], notSampled: ['ua', '零聲母音節 wu、wa 的寫法'], source: '概覽：四年級第一學段第二單元第三課；教材照片 4-3.1（第20頁）。'},
    items: [
      {id: 'g4-s1', type: 'sound', focus: 'u', prompt: '「數重山」的「數」，韻母是哪一個？', audio: {char: '數', pinyin: 'shù'}, options: options('ua', 'u', 'uo'), answerId: 'b', explanation: '「數重山」指幾重山，「數」讀 shù，韻母是 u。這裏不是「數一數」的 shǔ。'},
      {id: 'g4-d1', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「新綠」的「綠」。', char: '綠', pinyin: 'lǜ'}, target: {char: '綠', pinyin: 'lǜ', accept: ['綠', '绿']}, explanation: '新綠的「綠」。詩裏把「綠」用作動詞，寫出春風使江岸草木變綠。'},
      {id: 'g4-s2', type: 'sound', focus: 'uo', prompt: '「我」的韻母是哪一個？仔細聽，再放入貨架。', audio: {char: '我', pinyin: 'wǒ'}, options: options('uo', 'u', 'ua'), answerId: 'a', explanation: '「我」讀 wǒ，韻母是 uo。uo 前面沒有聲母時，寫成 wo，不能只把 o 當作完整韻母。'},
      {id: 'g4-d2', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「還鄉」的「還」。', char: '還', pinyin: 'huán'}, target: {char: '還', pinyin: 'huán', accept: ['還', '还']}, explanation: '還鄉的「還」，意思是回去，讀 huán。詩人盼望回到家鄉。'},
      {id: 'g4-m1', type: 'match', prompt: '替三張畫配上心聲：哪張寫距離，哪張寫春意，哪張寫思念？', modelSlug: 'bo-chuan-gua-zhou', cards: [{id: 'a', label: '畫片甲', image: scene('bo-chuan-gua-zhou', 1)}, {id: 'b', label: '畫片乙', image: scene('bo-chuan-gua-zhou', 3)}, {id: 'c', label: '畫片丙', image: scene('bo-chuan-gua-zhou', 4)}], slots: [{id: 'one', label: '春天又回來了', accepts: 'b'}, {id: 'two', label: '兩地只隔一江水', accepts: 'a'}, {id: 'three', label: '盼望回到家鄉', accepts: 'c'}], explanation: '隔江相望寫距離，江岸新綠寫春意，明月照歸途寫思鄉。同一首詩，風景也能帶出心情。'}
    ]
  },
  'gui-yuan-tian-ju': {
    grade: 5,
    title: '田園的一日',
    curriculum: {unit: 2, lesson: 3, focus: '分辨聲母 n、l', sampled: ['n', 'l'], notSampled: ['句子中的 n、l 連續辨讀及口語產出'], source: '概覽：五年級第一學段第二單元第三課；教材照片 5-3.1（第20頁）。兩道聽辨只記錄辨認表現，不能推斷實際發音能力。'},
    items: [
      {id: 'g5-s1', type: 'sound', focus: 'n', prompt: '只靠耳朵找聲母：這個聲音應放到哪一格？', audio: {char: '南', pinyin: 'nán'}, options: options('l', 'n'), answerId: 'b', explanation: '聽到的是「南」nán，聲母是鼻音 n；「蘭」lán 的聲母是 l。n 的氣流經鼻腔發出。'},
      {id: 'g5-d1', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「稀疏」的「稀」。', char: '稀', pinyin: 'xī'}, target: {char: '稀', pinyin: 'xī', accept: ['稀']}, explanation: '稀疏的「稀」，左邊是禾字旁。豆苗長得少，不能把它想成茂密的一大片。'},
      {id: 'g5-s2', type: 'sound', focus: 'l', prompt: '留意字音的開頭，這次應放到哪一格？', audio: {char: '露', pinyin: 'lù'}, options: options('n', 'l'), answerId: 'b', explanation: '「夕露」的「露」讀 lù，聲母是 l，氣流從舌頭兩側通過。不要和聲母是 n 的「怒」nù 混淆。'},
      {id: 'g5-d2', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「鋤頭」的「鋤」。', char: '鋤', pinyin: 'chú'}, target: {char: '鋤', pinyin: 'chú', accept: ['鋤', '锄']}, explanation: '鋤頭的「鋤」，有金字旁。「帶月荷鋤歸」中的「荷」讀 hè，意思是扛着。'},
      {id: 'g5-m1', type: 'scene-builder', prompt: '把田地變成詩中的樣子。分別調整野草和豆苗，看看畫面怎樣變。', modelSlug: 'gui-yuan-tian-ju', layers: [{id: 'grass', label: '野草', choices: [{id: 'sparse', label: '稀疏'}, {id: 'dense', label: '茂盛'}]}, {id: 'beans', label: '豆苗', choices: [{id: 'sparse', label: '稀疏'}, {id: 'dense', label: '茂盛'}]}], answer: {grass: 'dense', beans: 'sparse'}, explanation: '草盛豆苗稀：茂盛的是野草，稀疏的是豆苗。耕種並不輕鬆，這才接得上詩人清晨除草、月下歸家的辛勞。'}
    ]
  },
  'zao-chun': {
    grade: 6,
    title: '收集一點春色',
    curriculum: {unit: 2, lesson: 3, focus: '分辨聲母 x、s、sh', sampled: ['x', 's'], notSampled: ['sh 的獨立聽辨', 'x 與 ü 行韻母相拼的省點規則'], source: '概覽：六年級第一學段第二單元第三課；教材照片 6-3.1（第20頁）。sh 作干擾項不等於已獨立考查 sh。'},
    items: [
      {id: 'g6-s1', type: 'sound', focus: 'x', prompt: '不看漢字，只聽開頭。這個字的聲母是哪一個？', audio: {char: '小', pinyin: 'xiǎo'}, options: options('s', 'sh', 'x'), answerId: 'c', explanation: '聽到的是「小」xiǎo，聲母是舌面音 x。「少」shǎo 用的是翹舌音 sh，兩個字的聲母不同。'},
      {id: 'g6-d1', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「滋潤」的「潤」。', char: '潤', pinyin: 'rùn'}, target: {char: '潤', pinyin: 'rùn', accept: ['潤', '润']}, explanation: '滋潤的「潤」，左邊是三點水。「潤如酥」寫出細雨柔和、細膩地滋養大地的感覺。'},
      {id: 'g6-s2', type: 'sound', focus: 's', prompt: '再分辨一次：把聽到的聲音送到合適的聲母貨架。', audio: {char: '酥', pinyin: 'sū'}, options: options('sh', 's', 'x'), answerId: 'b', explanation: '聽到的是「酥」sū，聲母是平舌音 s；「書」shū 的聲母才是翹舌音 sh。'},
      {id: 'g6-d2', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「遙望」的「遙」。', char: '遙', pinyin: 'yáo'}, target: {char: '遙', pinyin: 'yáo', accept: ['遙', '遥']}, explanation: '遙望的「遙」，有走之旁，表示從遠處看。別與提手旁的「搖」混淆。'},
      {id: 'g6-m1', type: 'match', prompt: '同一片早春草地，兩次觀察。比較照片，把它們放到合適的距離。', modelSlug: 'zao-chun', cards: [{id: 'a', label: '照片甲', image: 'media/challenges/zao-chun-far.webp'}, {id: 'b', label: '照片乙', image: 'media/challenges/zao-chun-near.webp'}], slots: [{id: 'one', label: '走近細看', accepts: 'b'}, {id: 'two', label: '站遠眺望', accepts: 'a'}], explanation: '遠處，細小草芽的綠意彷彿連成一片；走近，草芽仍稀疏，泥土清楚可見。「近卻無」不是草突然消失，而是連成一片的草色不明顯。'}
    ]
  }
});
