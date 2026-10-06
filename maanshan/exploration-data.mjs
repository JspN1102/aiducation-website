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
    assetVersion: '20260920a', modelFile: 'model-20260920a.glb',
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
  },
  // Preview poems 7-12: shown only to accounts that load poems-preview.json.
  'yong-xue': {
    object: '白梅', motif: 'snow', scene: '飛入梅花都不見',
    assetVersion: '20261005', modelFile: 'model-20261005.glb',
    initialView: [1, .3, .2], viewDistance: .75,
    alt: '積雪的石頭上長出一枝白梅，枝頭開滿白色的梅花，花和枝上都蓋着白雪。',
    finish: '雪是白的，梅花也是白的。雪花飛進梅花裏，就分不出來了。',
    observations: [
      {title: '一片一片數雪花', verse: '一片兩片三四片', word: ['片', 'piàn'],
        guide: '轉一轉，看看枝頭和石頭上的白雪。', inspect: 'side', clue: '詩裏沒有一個「雪」字，可是每一句都在寫雪花。',
        question: '「一片兩片三四片」數的是甚麼？', choices: ['飄下來的雪花', '樹上的葉子'], answer: 0,
        feedback: '詩人一片一片地數雪花。全詩沒有「雪」字，卻句句寫雪。'},
      {title: '雪花去哪裏了？', verse: '飛入梅花都不見', word: ['梅', 'méi'],
        guide: '靠近一點，看看白白的梅花和白白的雪。', inspect: 'detail', clue: '梅花是白色的，雪花也是白色的。',
        question: '雪花飛進梅花裏，為甚麼看不見了？', choices: ['雪花飛走了', '雪和梅花一樣白，分不出來'], answer: 1,
        feedback: '白雪落在白梅上，顏色一樣，所以「都不見」了。'}
    ]
  },
  'hua-ji': {
    object: '公雞', motif: 'rooster', scene: '滿身雪白走將來',
    assetVersion: '20261005', modelFile: 'model-20261005.glb',
    initialView: [1, .3, .55], viewDistance: .75,
    alt: '一隻全身雪白的大公雞，頭上長着鮮紅的雞冠，正抬起腳向前走。',
    finish: '紅冠白羽，昂首走來；公雞一叫，千家萬戶都開門了。',
    observations: [
      {title: '頭上紅紅的是甚麼？', verse: '頭上紅冠不用裁', word: ['裁', 'cái'],
        guide: '轉一轉，看看公雞頭頂紅紅的雞冠。', inspect: 'detail', clue: '「裁」是用剪刀剪。雞冠是天生的，又紅又有齒。',
        question: '「不用裁」是甚麼意思？', choices: ['紅冠天生就有，不用剪', '要用剪刀剪出紅冠'], answer: 0,
        feedback: '公雞的紅冠是天生的，不用剪裁，就像戴着一頂紅帽子。'},
      {title: '公雞怎樣走來？', verse: '滿身雪白走將來', word: ['將', 'jiāng'],
        guide: '從遠一點看整隻公雞，看看牠的羽毛和腳步。', inspect: 'far', clue: '「雪白」是像雪一樣白；「走將來」是走過來。',
        question: '「滿身雪白」寫出公雞的甚麼？', choices: ['公雞身上落滿了雪', '全身羽毛像雪一樣白'], answer: 1,
        feedback: '「雪白」寫羽毛的顏色，不是真的雪。公雞全身雪白，神氣地走過來。'}
    ]
  },
  'qi-bu-shi': {
    object: '灶和釜', motif: 'beans', scene: '萁在釜下燃',
    assetVersion: '20261005', modelFile: 'model-20261005.glb',
    initialView: [1, .42, .5], viewDistance: .7,
    alt: '泥砌的土灶上架着一口大鐵鍋，鍋裏煮着豆子，灶口下燒着一束豆萁。',
    finish: '豆和萁本是同一條根長出來的。詩人借煮豆，勸兄弟不要互相傷害。',
    observations: [
      {title: '灶下燒的是甚麼？', verse: '萁在釜下燃', word: ['萁', 'qí'],
        guide: '轉到灶口那一面，看看火裏燒的東西。', inspect: 'side', clue: '「萁」是豆子的莖稈，曬乾可以當柴燒；「釜」是古時的鍋。',
        question: '「萁在釜下燃」，燒的是甚麼？', choices: ['木柴和煤炭', '豆子的莖稈'], answer: 1,
        feedback: '豆萁在鍋下燃燒，鍋裏煮的正是豆子。'},
      {title: '鍋裏的豆子怎麼了？', verse: '豆在釜中泣', word: ['泣', 'qì'],
        guide: '從上面看看鍋裏的豆子。', inspect: 'top', clue: '「泣」是小聲地哭。豆子會哭嗎？詩人把豆子當成人來寫。',
        question: '詩人為甚麼說豆子在「泣」？', choices: ['被同根的萁煎煮，好像傷心地哭', '豆子煮得太好吃了'], answer: 0,
        feedback: '這是擬人的寫法：豆和萁同根生，萁卻燒豆，豆子傷心地哭，比喻兄弟相逼。'}
    ]
  },
  'jue-ju': {
    object: '草堂春景', motif: 'oriole', scene: '窗含西嶺千秋雪',
    assetVersion: '20261006', modelFile: 'model-20261006.glb',
    initialView: [1, .4, .3], viewDistance: .68,
    alt: '草堂旁一棵翠綠的柳樹，枝上停着黃鸝；遠處是積雪的西嶺，門前江邊泊着一艘船。',
    finish: '近處有黃鸝翠柳，遠處有雪山和船；四句詩畫出一幅有遠有近的春景。',
    observations: [
      {title: '柳樹上有誰？', verse: '兩個黃鸝鳴翠柳', word: ['鸝', 'lí'],
        guide: '靠近柳樹，找找枝上黃色的小鳥。', inspect: 'near', clue: '「黃鸝」是黃色的鳥；「翠」是青綠色；「鳴」是叫。',
        question: '「兩個黃鸝鳴翠柳」寫了哪兩種顏色？', choices: ['黃色和翠綠色', '紅色和白色'], answer: 0,
        feedback: '黃鸝的黃，配上柳樹的翠綠，顏色鮮明，充滿春天的生氣。'},
      {title: '窗外的雪為甚麼不化？', verse: '窗含西嶺千秋雪', word: ['含', 'hán'],
        guide: '退遠一點，從草堂往外看遠處的雪山。', inspect: 'far', clue: '「千秋」是很多很多年；高山上的積雪終年不化。',
        question: '「千秋雪」是甚麼意思？', choices: ['剛下了一千天的雪', '山上多年不化的積雪'], answer: 1,
        feedback: '西嶺高山上的雪多年不化，從窗口望去，好像被窗框「含」在裏面。'}
    ]
  },
  'zheng-ren-mai-lu': {
    object: '座位和量繩', motif: 'shoe', scene: '先自度其足',
    assetVersion: '20261006', modelFile: 'model-20261006.glb',
    initialView: [1, .55, .8], viewDistance: .68,
    alt: '一張木座位上放着量腳用的繩子和竹尺，旁邊擺着一雙布鞋。',
    finish: '尺碼是死的，腳是活的。做事要從實際出發，懂得變通。',
    observations: [
      {title: '量好的尺碼放在哪裏？', verse: '鄭人有且置履者，先自度其足而置之其坐', word: ['度', 'duó'],
        guide: '從上面看看座位上的繩子和尺。', inspect: 'top', clue: '「度」讀 duó 時是動詞，即「量」；「坐」通「座」，指座位。',
        question: '「先自度其足」的「度」是甚麼意思？', choices: ['量', '尺碼'], answer: 0,
        feedback: '鄭國人先量好自己的腳，再把量好的尺碼放在座位上。'},
      {title: '買鞋該相信甚麼？', verse: '人曰：「何不試之以足？」曰：「寧信度，無自信也。」', word: ['度', 'dù'],
        guide: '轉到側面，看看那雙鞋，再看看量繩。', inspect: 'side', clue: '「度」讀 dù 時是名詞，指量好的尺碼。腳就長在自己身上。',
        question: '鄭國人錯在哪裏？', choices: ['他沒有帶錢去市集', '寧可相信尺碼，不相信自己的腳'], answer: 1,
        feedback: '用腳一試就知道合不合穿。只相信尺碼、不懂變通，結果買不到鞋。'}
    ]
  },
  'ke-zhi': {
    object: '草堂', motif: 'cup', scene: '蓬門今始為君開',
    assetVersion: '20261006', modelFile: 'model-20261006.glb',
    initialView: [1, .5, .2], viewDistance: .65,
    alt: '春水環繞的草堂，院子裏有花徑、竹籬笆和小桌，簡樸而清靜。',
    finish: '家貧菜少，卻真誠待客，還隔着籬笆請鄰翁同飲，主客情誼真摯。',
    observations: [
      {title: '為客人打開的門', verse: '花徑不曾緣客掃，蓬門今始為君開', word: ['蓬', 'péng'],
        guide: '轉到草堂正面，沿着花徑找找草屋的門。', inspect: 'side', clue: '「蓬門」是用蓬草編成的門，可見家境簡樸；「君」指來訪的客人。',
        question: '「蓬門今始為君開」表達了詩人怎樣的心情？', choices: ['嫌客人來得太早', '平日少客，今天特意為客人開門，十分歡喜'], answer: 1,
        feedback: '平日少有客人，花徑也沒有打掃；今天第一次為你開門，可見詩人多麼高興。'},
      {title: '隔着籬笆叫誰？', verse: '肯與鄰翁相對飲，隔籬呼取盡餘杯', word: ['籬', 'lí'],
        guide: '轉一轉，看看院子四周的竹籬笆。', inspect: 'top', clue: '「籬」是用竹子或樹枝編成的圍欄；「鄰翁」是隔壁的老人家。',
        question: '詩人想隔着籬笆做甚麼？', choices: ['叫鄰居老翁過來一起喝酒', '叫鄰居幫忙打掃花徑'], answer: 0,
        feedback: '「肯」是願意。詩人問客人願不願意和鄰翁對飲，再隔着籬笆把老人家叫來，一起喝完剩下的酒。'}
    ]
  }
});
