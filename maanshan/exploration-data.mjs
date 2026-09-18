// Observation prompts are grounded in the selected poem; they are not speech scores.
export const EXPLORATION_CONTENT = Object.freeze({
  'yong-e': {
    object: '白鵝', motif: 'goose', scene: '清波上的白鵝',
    initialView: [1, .28, .16],
    alt: '白鵝在清澈的水上游動，紅掌在水下撥出波紋。',
    finish: '看顏色，也看動作，白鵝就從詩裏游出來了。',
    observations: [
      {title: '找一找，誰在撥水？', verse: '紅掌撥清波', word: ['掌', 'zhǎng'],
        guide: '找找身體下方的腳掌。牠怎樣撥水呢？', inspect: 'detail', clue: '「紅掌」是紅色的腳掌，用來撥水。',
        question: '白鵝用甚麼撥水？', choices: ['紅紅的腳掌', '白白的羽毛'], answer: 0,
        feedback: '紅掌一撥，清清的水就漾起波紋。'},
      {title: '看看白鵝的脖子', verse: '曲項向天歌', word: ['曲', 'qū'],
        guide: '轉到側面，沿着白鵝的長脖子看一看。', inspect: 'side', clue: '從頭沿着脖子往下看，留意彎曲的線條。',
        question: '「曲項」是甚麼樣子？', choices: ['把頭藏起來', '彎着脖子'], answer: 1,
        feedback: '「曲」是彎曲，「項」是脖子。白鵝彎着脖子，向天鳴叫。'}
    ]
  },
  'zeng-wang-lun': {
    object: '小舟', motif: 'boat', scene: '桃花潭上的送別',
    alt: '木舟停在桃花潭的岸邊，潭水與春日山色相映。',
    finish: '小舟將要離岸，一首送別的歌，把朋友的深情留下來。',
    observations: [
      {title: '小舟要出發了', verse: '李白乘舟將欲行', word: ['舟', 'zhōu'],
        guide: '轉轉小舟，看看船身和船裏的空間。', inspect: 'top', clue: '「舟」就是船；想像李白坐進小舟，準備離岸。',
        question: '這一句寫李白準備怎樣離開？', choices: ['騎馬離開', '乘船離開'], answer: 1,
        feedback: '「舟」就是船；「將欲行」告訴我們，他正要出發。'},
      {title: '聽見岸上的歌', verse: '忽聞岸上踏歌聲', word: ['踏', 'tà'],
        guide: '回到畫面，找找小舟停靠的岸邊。', inspect: 'picture', clue: '想像你坐在舟上，朝岸邊揮手道別。',
        question: '送別的歌聲從哪裏傳來？', choices: ['岸上', '水底'], answer: 0,
        feedback: '岸上的踏歌聲，是朋友的送別。「踏歌」是一邊踏着節拍，一邊唱歌。'}
    ]
  },
  'ti-xi-lin-bi': {
    object: '山嶺', motif: 'mountain', scene: '換個角度看山',
    assetVersion: '20260914-restored',
    initialView: [1, .32, 0],
    alt: '雲霧間連綿的山嶺與高聳的山峯，呈現不同方向的山形。',
    finish: '同一座山，換個位置就有新發現。看事情也可以多找幾個角度。',
    observations: [
      {title: '換個方向，有何不同？', verse: '橫看成嶺側成峯', word: ['側', 'cè'],
        guide: '用手指轉轉山，從不同方向比較山的輪廓。', inspect: 'front', clue: '換一邊看，試着用手指描出山的外形。',
        question: '詩人換了方向，看見甚麼變化？', choices: ['山的形狀看起來不同', '山真的移到別處了'], answer: 0,
        feedback: '橫看是連綿的山嶺，側看是突起的山峯。觀察方向改變，眼前的山形也不同。'},
      {title: '走出山中，再想一想', verse: '只緣身在此山中', word: ['緣', 'yuán'],
        guide: '先放大看局部，再縮小看看整座山。', inspect: 'near', clue: '只看眼前的一小部分，能知道整座山的樣子嗎？',
        question: '為甚麼難看清廬山的全貌？', choices: ['山沒有任何形狀', '自己身在山中'], answer: 1,
        feedback: '「只緣」是只因為。身在山中，眼前能看見的只是山的一部分。'}
    ]
  },
  'bo-chuan-gua-zhou': {
    object: '江岸', motif: 'moon', scene: '春風又到江南岸',
    assetVersion: '20260919b', modelFile: 'model-20260919b.glb',
    initialView: [1, .9, .02], viewDistance: .68,
    alt: '春日江水隔開兩岸，岸邊新綠與遠山映在柔和的天光中。',
    finish: '一江春水，一岸新綠；眼前的風景，牽起了詩人的歸鄉心情。',
    observations: [
      {title: '兩地之間，隔着甚麼？', verse: '京口瓜洲一水間', word: ['洲', 'zhōu'],
        guide: '從上方看看兩岸，找出中間的江水。', inspect: 'top', clue: '用手指在空中連一連兩岸，中間要經過哪裏？',
        question: '京口和瓜洲之間隔着甚麼？', choices: ['一片沙漠', '一條長江'], answer: 1,
        feedback: '京口和瓜洲隔江相望。「一水」指兩地之間的長江。'},
      {title: '哪個字，讓江岸有了春意？', verse: '春風又綠江南岸', word: ['綠', 'lǜ'],
        guide: '靠近江岸，找找春天剛添上的綠色。', inspect: 'near', clue: '留意岸邊草木的顏色，想像春風吹過。',
        question: '「綠」在這一句寫出甚麼？', choices: ['春風讓江岸草木變綠', '江水變成了冰'], answer: 0,
        feedback: '「綠」寫出草木在春風中重新生長，讓江岸有了鮮活的春意。'}
    ]
  },
  'gui-yuan-tian-ju': {
    object: '田地', motif: 'sprout', scene: '草盛豆苗稀',
    assetVersion: '20260914-overgrown',
    initialView: [0, 1.05, 1],
    viewDistance: .72,
    alt: '田地裏細長的野草密密生長，只有幾株寬葉豆苗疏疏落落地夾在其中。',
    finish: '豆苗雖稀，耕作雖累，詩人仍願意守着自己的田園心願。',
    observations: [
      {title: '分清豆苗和野草', verse: '草盛豆苗稀', word: ['稀', 'xī'],
        guide: '找找寬寬的豆葉，轉動田地，比較野草和豆苗的疏密。', inspect: 'top', clue: '細長的是野草，寬葉的是豆苗。從上面看，哪一種長得更多？',
        question: '詩中哪一種長得更茂盛？', choices: ['野草', '豆苗'], answer: 0,
        feedback: '「盛」是茂盛，「稀」是稀疏。野草長得盛，豆苗卻疏疏落落。'},
      {title: '月亮出來，才回家', verse: '帶月荷鋤歸', word: ['荷', 'hè'],
        guide: '想像忙完農活，試着做一做扛鋤頭的動作。', inspect: 'picture', clue: '把一隻手放到肩旁，想像扛着鋤頭回家。',
        question: '這裏的「荷鋤」是甚麼意思？', choices: ['把鋤頭當作荷花', '扛着鋤頭'], answer: 1,
        feedback: '「荷」在這裏讀 hè，意思是扛着。詩人伴着月色，扛着鋤頭回家。'}
    ]
  },
  'zao-chun': {
    object: '春草', motif: 'swallow', scene: '早春的一點新綠',
    assetVersion: '20260919b', modelFile: 'model-20260919b.glb',
    initialView: [1, 1.05, 1.2], viewDistance: .62,
    alt: '細雨滋潤的土地上，稀疏的嫩草帶着很淡的綠意。',
    finish: '剛冒出的春草很細很稀。遠近之間的一點不同，也能成為詩中的美。',
    observations: [
      {title: '遠看有綠，近看呢？', verse: '草色遙看近卻無', word: ['遙', 'yáo'],
        guide: '用雙指放大、縮小，找找綠色的草芽與棕色的泥土。', inspect: 'near', clue: '近看時留意草芽之間露出的泥土。',
        question: '遠看有淡綠，近看卻不明顯，為甚麼？', choices: ['草會突然消失', '新草細小，長得稀疏'], answer: 1,
        feedback: '新草剛冒出來，遠看連成淡淡的綠；走近看，細小的草芽還散在泥土間。'},
      {title: '留意早春的小雨', verse: '天街小雨潤如酥', word: ['潤', 'rùn'],
        guide: '靠近土地，想像小雨輕輕落下來的感覺。', inspect: 'near', clue: '讀一讀「潤如酥」，是輕柔的小雨，還是猛烈的暴雨？',
        question: '「潤」寫出小雨帶來甚麼感覺？', choices: ['細細滋潤', '乾燥灼熱'], answer: 0,
        feedback: '細雨輕輕滋潤大地。「潤如酥」寫出了早春小雨的細膩與柔和。'}
    ]
  }
});
