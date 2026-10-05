// Questions for the second set of poems (poems-preview.json). The shape follows
// challenge-data.mjs; ids start with p<poem id> because these poems share grades
// with the first six. Same rules: render only prompt/options/cards/slot labels
// before submission.
export const PREVIEW_SETS = {
  'yong-xue': {
    grade: 1,
    idPrefix: "p7",
    title: "雪花數一數",
    curriculum: {"unit": 1, "lesson": 1, "focus": "學習四聲", "sampled": ["第二聲", "第三聲"], "notSampled": ["第一聲", "第四聲"], "source": "概覽：一年級第一學段第一單元第一課；教材照片 1-1.2（第4頁）。"},
    items: [
      {"id": "p7-s1", "type": "sound", "focus": "第二聲", "prompt": "聽一聽，這個字是第幾聲？", "audio": {"char": "十", "pinyin": "shí"}, "options": [{"id": "a", "label": "第一聲", "contour": "level"}, {"id": "b", "label": "第二聲", "contour": "rising"}, {"id": "c", "label": "第三聲", "contour": "dipping"}, {"id": "d", "label": "第四聲", "contour": "falling"}], "answerId": "b", "explanation": "「十」讀 shí，是第二聲。聲音向上揚，像走上一個小斜坡。"},
      {"id": "p7-d1", "type": "dictation", "prompt": "聽一聽，寫出指定的字。", "audio": {"text": "請寫出「梅花」的「梅」。", "char": "梅", "pinyin": "méi"}, "target": {"char": "梅", "pinyin": "méi", "accept": ["梅"]}, "explanation": "梅花的「梅」，左邊是木字旁。梅花不怕冷，在大雪中也能開花。"},
      {"id": "p7-s2", "type": "sound", "focus": "第三聲", "prompt": "再聽一個字，把聲音送到合適的聲調小站。", "audio": {"char": "九", "pinyin": "jiǔ"}, "options": [{"id": "a", "label": "第一聲", "contour": "level"}, {"id": "b", "label": "第二聲", "contour": "rising"}, {"id": "c", "label": "第三聲", "contour": "dipping"}, {"id": "d", "label": "第四聲", "contour": "falling"}], "answerId": "c", "explanation": "「九」單獨讀 jiǔ，是第三聲。聲音先往下，再往上。"},
      {"id": "p7-d2", "type": "dictation", "prompt": "聽一聽，寫出指定的字。", "audio": {"text": "請寫出「雪片」的「片」。", "char": "片", "pinyin": "piàn"}, "target": {"char": "片", "pinyin": "piàn", "accept": ["片"]}, "explanation": "雪片的「片」。詩人一片、兩片地數雪花，「片」字在詩裏一共出現了七次。"},
      {"id": "p7-m1", "type": "sequence", "prompt": "雪越下越大，最後飛到哪裏？把三張雪景卡依次放好。", "cards": [{"id": "a", "label": "飄下幾片雪花", "image": "media/yong-xue/scene-1.webp"}, {"id": "b", "label": "大雪滿天飛", "image": "media/yong-xue/scene-3.webp"}, {"id": "c", "label": "雪花飛進梅花", "image": "media/yong-xue/scene-4.webp"}], "slots": [{"id": "one", "label": "先", "accepts": "a"}, {"id": "two", "label": "接着", "accepts": "b"}, {"id": "three", "label": "最後", "accepts": "c"}], "explanation": "詩人先一片、兩片地數雪花；接着雪越下越大，千片萬片數不清；最後雪花飛進梅花叢中，都不見了。"}
    ],
    moreSounds: [
      {"id": "p7-s3", "type": "sound", "focus": "第一聲", "prompt": "聽一聽，這個字是第幾聲？", "audio": {"char": "飛", "pinyin": "fēi"}, "options": [{"id": "a", "label": "第一聲", "contour": "level"}, {"id": "b", "label": "第二聲", "contour": "rising"}, {"id": "c", "label": "第三聲", "contour": "dipping"}, {"id": "d", "label": "第四聲", "contour": "falling"}], "answerId": "a", "explanation": "「飛」讀 fēi，是第一聲。聲音平平地保持住。"},
      {"id": "p7-s4", "type": "sound", "focus": "第四聲", "prompt": "聽一聽，這個字是第幾聲？", "audio": {"char": "片", "pinyin": "piàn"}, "options": [{"id": "a", "label": "第一聲", "contour": "level"}, {"id": "b", "label": "第二聲", "contour": "rising"}, {"id": "c", "label": "第三聲", "contour": "dipping"}, {"id": "d", "label": "第四聲", "contour": "falling"}], "answerId": "d", "explanation": "「片」讀 piàn，是第四聲。聲音從高處往下降。"}
    ],
    variedSounds: [
      {"id": "p7-s5", "type": "sound", "focus": "第二聲", "prompt": "聽一聽，這個字是第幾聲？", "audio": {"char": "梅", "pinyin": "méi"}, "options": [{"id": "a", "label": "第一聲", "contour": "level"}, {"id": "b", "label": "第二聲", "contour": "rising"}, {"id": "c", "label": "第三聲", "contour": "dipping"}, {"id": "d", "label": "第四聲", "contour": "falling"}], "answerId": "b", "explanation": "「梅」讀 méi，是第二聲，聲音往上揚。"},
      {"id": "p7-s6", "type": "sound", "focus": "第三聲", "prompt": "聽一聽，這個字是第幾聲？", "audio": {"char": "五", "pinyin": "wǔ"}, "options": [{"id": "a", "label": "第一聲", "contour": "level"}, {"id": "b", "label": "第二聲", "contour": "rising"}, {"id": "c", "label": "第三聲", "contour": "dipping"}, {"id": "d", "label": "第四聲", "contour": "falling"}], "answerId": "c", "explanation": "「五」單獨讀 wǔ，是第三聲，先低下來，再往上揚。"},
      {"id": "p7-s7", "type": "sound", "focus": "第一聲", "prompt": "聽一聽，找出一樣的聲調。", "audio": {"char": "花", "pinyin": "huā"}, "options": [{"id": "a", "label": "huà"}, {"id": "b", "label": "huā"}, {"id": "c", "label": "huá"}, {"id": "d", "label": "huǎ"}], "answerId": "b", "explanation": "「花」讀 huā。第一聲的聲調符號是平平的一橫。", "difficulty": 2},
      {"id": "p7-s8", "type": "sound", "focus": "第二聲", "prompt": "聽一聽，找出一樣的聲調。", "audio": {"char": "無", "pinyin": "wú"}, "options": [{"id": "a", "label": "wū"}, {"id": "b", "label": "wǔ"}, {"id": "c", "label": "wù"}, {"id": "d", "label": "wú"}], "answerId": "d", "explanation": "「無」讀 wú。第二聲的聲調符號向上揚。", "difficulty": 2},
      {"id": "p7-s9", "type": "sound", "focus": "第三聲", "prompt": "聽一聽，找出一樣的聲調。", "audio": {"char": "兩", "pinyin": "liǎng"}, "options": [{"id": "a", "label": "liǎng"}, {"id": "b", "label": "liáng"}, {"id": "c", "label": "liàng"}, {"id": "d", "label": "liāng"}], "answerId": "a", "explanation": "「兩」單獨讀 liǎng。第三聲的符號先往下，再往上。", "difficulty": 2},
      {"id": "p7-s10", "type": "sound", "focus": "第四聲", "prompt": "聽一聽，找出一樣的聲調。", "audio": {"char": "萬", "pinyin": "wàn"}, "options": [{"id": "a", "label": "wān"}, {"id": "b", "label": "wán"}, {"id": "c", "label": "wàn"}, {"id": "d", "label": "wǎn"}], "answerId": "c", "explanation": "「萬」讀 wàn。第四聲的聲調符號從高處往下降。", "difficulty": 2}
    ],
    dictationBank: [
      {"char": "片", "pinyin": "piàn", "word": "雪片", "accept": ["片"]},
      {"char": "兩", "pinyin": "liǎng", "word": "兩個", "accept": ["兩", "两"]},
      {"char": "千", "pinyin": "qiān", "word": "一千", "accept": ["千"]},
      {"char": "萬", "pinyin": "wàn", "word": "一萬", "accept": ["萬", "万"]},
      {"char": "無", "pinyin": "wú", "word": "無數", "accept": ["無", "无"]},
      {"char": "飛", "pinyin": "fēi", "word": "飛舞", "accept": ["飛", "飞"]},
      {"char": "梅", "pinyin": "méi", "word": "梅花", "accept": ["梅"]},
      {"char": "花", "pinyin": "huā", "word": "雪花", "accept": ["花"]},
      {"char": "見", "pinyin": "jiàn", "word": "看見", "accept": ["見", "见"]}
    ]
  },
  'hua-ji': {
    grade: 2,
    idPrefix: "p8",
    title: "大公雞的早晨",
    curriculum: {"unit": 2, "lesson": 4, "focus": "ua、uo、uai、ui（uei）", "sampled": ["ua", "ui（uei）"], "notSampled": ["uo", "uai"], "source": "概覽：二年級第一學段第二單元第四課；教材照片 2-4.3（第27頁）。《畫雞》正文沒有 ua、uo、uai、ui（uei）的直接例字：ua 取自詩題「畫」，其餘以拓展字練習。"},
    items: [
      {"id": "p8-s1", "type": "sound", "focus": "ua", "prompt": "「畫」的韻母是哪一個？", "audio": {"char": "畫", "pinyin": "huà"}, "options": [{"id": "a", "label": "uo"}, {"id": "b", "label": "ua"}, {"id": "c", "label": "uai"}], "answerId": "b", "explanation": "詩題「畫雞」的「畫」讀 huà，韻母是 ua。「火」的韻母才是 uo，聽起來不一樣。"},
      {"id": "p8-d1", "type": "dictation", "prompt": "聽一聽，寫出指定的字。", "audio": {"text": "請寫出「雪白」的「雪」。", "char": "雪", "pinyin": "xuě"}, "target": {"char": "雪", "pinyin": "xuě", "accept": ["雪"]}, "explanation": "雪白的「雪」，上面是雨字頭。詩裏用「雪白」寫公雞全身潔白的羽毛。"},
      {"id": "p8-s2", "type": "sound", "focus": "ui（uei）", "prompt": "「嘴」的韻母，在拼音中寫成甚麼？", "audio": {"char": "嘴", "pinyin": "zuǐ"}, "options": [{"id": "a", "label": "iu"}, {"id": "b", "label": "uai"}, {"id": "c", "label": "ui"}], "answerId": "c", "explanation": "拓展字「嘴」讀 zuǐ。uei 跟聲母相拼時寫成 ui；iu 的先後次序不同。公雞啼叫時，會張開嘴巴。"},
      {"id": "p8-d2", "type": "dictation", "prompt": "聽一聽，寫出指定的字。", "audio": {"text": "請寫出「雞冠」的「冠」。", "char": "冠", "pinyin": "guān"}, "target": {"char": "冠", "pinyin": "guān", "accept": ["冠"]}, "explanation": "雞冠的「冠」，上面是禿寶蓋。「頭上紅冠」就是公雞頭頂紅紅的雞冠，這裏讀 guān。"},
      {"id": "p8-m1", "type": "sequence", "prompt": "大公雞做了甚麼？把三張故事卡依次放好。", "cards": [{"id": "a", "label": "大步走過來", "image": "media/hua-ji/scene-2.webp"}, {"id": "b", "label": "安靜不亂叫", "image": "media/hua-ji/scene-3.webp"}, {"id": "c", "label": "一叫喚醒千家萬戶", "image": "media/hua-ji/scene-4.webp"}], "slots": [{"id": "one", "label": "先", "accepts": "a"}, {"id": "two", "label": "接着", "accepts": "b"}, {"id": "three", "label": "最後", "accepts": "c"}], "explanation": "詩先寫公雞頭戴紅冠、全身雪白地走過來，接着寫牠平日不隨便啼叫，最後寫牠一叫，千家萬戶都打開門，開始新的一天。"}
    ],
    moreSounds: [
      {"id": "p8-s3", "type": "sound", "focus": "uo", "prompt": "聽清楚，找出這個字的韻母。", "audio": {"char": "說", "pinyin": "shuō"}, "options": [{"id": "a", "label": "ua"}, {"id": "b", "label": "uai"}, {"id": "c", "label": "uo"}], "answerId": "c", "explanation": "拓展字「說」讀 shuō，韻母是 uo。「輕言語」就是輕易說話，這裏指公雞的啼叫。"},
      {"id": "p8-s4", "type": "sound", "focus": "uai", "prompt": "聽清楚，找出這個字的韻母。", "audio": {"char": "外", "pinyin": "wài"}, "options": [{"id": "a", "label": "uai"}, {"id": "b", "label": "ui"}, {"id": "c", "label": "ua"}], "answerId": "a", "explanation": "拓展字「外」讀 wài，韻母是 uai。uai 前面沒有聲母時，音節寫成 wai。"}
    ],
    variedSounds: [
      {"id": "p8-s5", "type": "sound", "focus": "ua", "prompt": "聽清楚，找出這個字的韻母。", "audio": {"char": "花", "pinyin": "huā"}, "options": [{"id": "a", "label": "ui"}, {"id": "b", "label": "uo"}, {"id": "c", "label": "ua"}], "answerId": "c", "explanation": "拓展字「花」讀 huā，韻母是 ua，和「畫」的韻母一樣。唐寅擅長畫山水、人物和花鳥。"},
      {"id": "p8-s6", "type": "sound", "focus": "ui（uei）", "prompt": "聽清楚，找出這個字的韻母。", "audio": {"char": "睡", "pinyin": "shuì"}, "options": [{"id": "a", "label": "ua"}, {"id": "b", "label": "ui"}, {"id": "c", "label": "uo"}], "answerId": "b", "explanation": "拓展字「睡」讀 shuì，韻母 uei 跟聲母相拼時寫成 ui。"},
      {"id": "p8-s7", "type": "sound", "focus": "ua、uo、ui 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "畫", "pinyin": "huà"}, "options": [{"id": "a", "label": "huì"}, {"id": "b", "label": "huò"}, {"id": "c", "label": "huà"}], "answerId": "c", "explanation": "「畫」讀 huà，韻母是 ua。huì 和 huò 的韻母分別是 ui 和 uo。", "difficulty": 2},
      {"id": "p8-s8", "type": "sound", "focus": "uo、ua、uai 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "說", "pinyin": "shuō"}, "options": [{"id": "a", "label": "shuā"}, {"id": "b", "label": "shuō"}, {"id": "c", "label": "shuāi"}], "answerId": "b", "explanation": "拓展字「說」讀 shuō，韻母是 uo；shuā 的韻母是 ua，shuāi 的韻母是 uai。", "difficulty": 2},
      {"id": "p8-s9", "type": "sound", "focus": "ui、uai、uo 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "睡", "pinyin": "shuì"}, "options": [{"id": "a", "label": "shuài"}, {"id": "b", "label": "shuò"}, {"id": "c", "label": "shuì"}], "answerId": "c", "explanation": "拓展字「睡」讀 shuì，韻母寫作 ui；shuài 的韻母是 uai，shuò 的韻母是 uo。", "difficulty": 2},
      {"id": "p8-s10", "type": "sound", "focus": "uai、ua、ui 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "外", "pinyin": "wài"}, "options": [{"id": "a", "label": "wà"}, {"id": "b", "label": "wài"}, {"id": "c", "label": "wèi"}], "answerId": "b", "explanation": "拓展字「外」讀 wài，韻母是 uai。不要漏掉尾音 i，讀成 wà；wèi 的韻母是 uei。", "difficulty": 2}
    ],
    dictationBank: [
      {"char": "冠", "pinyin": "guān", "word": "雞冠", "accept": ["冠"]},
      {"char": "裁", "pinyin": "cái", "word": "剪裁", "accept": ["裁"]},
      {"char": "雪", "pinyin": "xuě", "word": "雪白", "accept": ["雪"]},
      {"char": "走", "pinyin": "zǒu", "word": "走路", "accept": ["走"]},
      {"char": "敢", "pinyin": "gǎn", "word": "勇敢", "accept": ["敢"]},
      {"char": "輕", "pinyin": "qīng", "word": "輕易", "accept": ["輕", "轻"]},
      {"char": "語", "pinyin": "yǔ", "word": "言語", "accept": ["語", "语"]},
      {"char": "叫", "pinyin": "jiào", "word": "叫聲", "accept": ["叫"]},
      {"char": "戶", "pinyin": "hù", "word": "萬戶", "accept": ["戶", "户"]}
    ]
  },
  'qi-bu-shi': {
    grade: 3,
    idPrefix: "p9",
    title: "豆子小廚房",
    curriculum: {"unit": 2, "lesson": 4, "focus": "複習聲母 g、k、h", "sampled": ["g", "k"], "notSampled": ["h"], "source": "概覽：三年級第一學段第二單元第四課；教材照片 3-4.1（第25頁）、3-4.2。"},
    items: [
      {"id": "p9-s1", "type": "sound", "focus": "g", "prompt": "聽清楚開頭的聲音，應送到哪個聲母貨架？", "audio": {"char": "根", "pinyin": "gēn"}, "options": [{"id": "a", "label": "h"}, {"id": "b", "label": "k"}, {"id": "c", "label": "g"}], "answerId": "c", "explanation": "「同根生」的「根」讀 gēn，聲母是 g。g 不送氣，k 送氣，讀 k 時氣流較強。"},
      {"id": "p9-d1", "type": "dictation", "prompt": "聽一聽，寫出指定的字。", "audio": {"text": "請寫出「燃燒」的「燃」。", "char": "燃", "pinyin": "rán"}, "target": {"char": "燃", "pinyin": "rán", "accept": ["燃"]}, "explanation": "燃燒的「燃」，左邊是火字旁，右邊是「然」。豆萁在鍋下燃燒，把豆子煮得翻滾。"},
      {"id": "p9-s2", "type": "sound", "focus": "k", "prompt": "再聽一個字，這次開頭的聲母是哪個？", "audio": {"char": "哭", "pinyin": "kū"}, "options": [{"id": "a", "label": "k"}, {"id": "b", "label": "g"}, {"id": "c", "label": "h"}], "answerId": "a", "explanation": "拓展字「哭」讀 kū，聲母是 k。詩中的「泣」也是哭的意思。把手放在嘴前讀一讀，能感到較明顯的氣流。"},
      {"id": "p9-d2", "type": "dictation", "prompt": "聽一聽，寫出指定的字。", "audio": {"text": "請寫出「哭泣」的「泣」。", "char": "泣", "pinyin": "qì"}, "target": {"char": "泣", "pinyin": "qì", "accept": ["泣"]}, "explanation": "哭泣的「泣」，左邊是三點水，右邊是「立」。詩人寫豆子在鍋中好像在哭泣。"},
      {"id": "p9-m1", "type": "sequence", "prompt": "這首詩怎樣展開？把三張故事卡依次放好。", "cards": [{"id": "a", "label": "煮豆子、濾豆汁", "image": "media/qi-bu-shi/scene-1.webp"}, {"id": "b", "label": "豆萁燒，豆子哭", "image": "media/qi-bu-shi/scene-2.webp"}, {"id": "c", "label": "原來本是同根生", "image": "media/qi-bu-shi/scene-3.webp"}], "slots": [{"id": "one", "label": "先", "accepts": "a"}, {"id": "two", "label": "接着", "accepts": "b"}, {"id": "three", "label": "最後", "accepts": "c"}], "explanation": "詩先寫煮豆、濾汁的生活小事，再寫豆萁在鍋下燃燒、豆子在鍋中哭泣，最後說豆和豆萁本是同根生，問為甚麼要這樣急着煎熬。"}
    ],
    moreSounds: [
      {"id": "p9-s3", "type": "sound", "focus": "h", "prompt": "聽開頭，找出這個字的聲母。", "audio": {"char": "何", "pinyin": "hé"}, "options": [{"id": "a", "label": "g"}, {"id": "b", "label": "h"}, {"id": "c", "label": "k"}], "answerId": "b", "explanation": "「相煎何太急」的「何」讀 hé，聲母是 h。讀 h 時，氣流從舌根和軟顎之間摩擦出來。"},
      {"id": "p9-s4", "type": "sound", "focus": "g", "prompt": "聽開頭，找出這個字的聲母。", "audio": {"char": "羹", "pinyin": "gēng"}, "options": [{"id": "a", "label": "k"}, {"id": "b", "label": "h"}, {"id": "c", "label": "g"}], "answerId": "c", "explanation": "「持作羹」的「羹」讀 gēng，聲母是 g，不送氣。詩中的「羹」是湯水。"}
    ],
    variedSounds: [
      {"id": "p9-s5", "type": "sound", "focus": "k", "prompt": "聽開頭，找出這個字的聲母。", "audio": {"char": "開", "pinyin": "kāi"}, "options": [{"id": "a", "label": "g"}, {"id": "b", "label": "h"}, {"id": "c", "label": "k"}], "answerId": "c", "explanation": "拓展字「開」讀 kāi，聲母是 k。鍋裏的水燒開了；讀 k 時能感到較明顯的氣流。"},
      {"id": "p9-s6", "type": "sound", "focus": "h", "prompt": "聽開頭，找出這個字的聲母。", "audio": {"char": "火", "pinyin": "huǒ"}, "options": [{"id": "a", "label": "h"}, {"id": "b", "label": "k"}, {"id": "c", "label": "g"}], "answerId": "a", "explanation": "拓展字「火」讀 huǒ，聲母是 h。豆萁在鍋下燒起了火；讀 h 時，氣流從舌根摩擦出來。"},
      {"id": "p9-s7", "type": "sound", "focus": "g、k、h 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "羹", "pinyin": "gēng"}, "options": [{"id": "a", "label": "kēng"}, {"id": "b", "label": "gēng"}, {"id": "c", "label": "hēng"}], "answerId": "b", "explanation": "「羹」讀 gēng，聲母是 g。三個拼音的韻母、聲調相同，要聽清開頭。", "difficulty": 2},
      {"id": "p9-s8", "type": "sound", "focus": "g、k、h 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "何", "pinyin": "hé"}, "options": [{"id": "a", "label": "ké"}, {"id": "b", "label": "gé"}, {"id": "c", "label": "hé"}], "answerId": "c", "explanation": "「相煎何太急」的「何」讀 hé，聲母是 h。三個選項只換了開頭的聲母。", "difficulty": 2},
      {"id": "p9-s9", "type": "sound", "focus": "g、k、h 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "哭", "pinyin": "kū"}, "options": [{"id": "a", "label": "gū"}, {"id": "b", "label": "kū"}, {"id": "c", "label": "hū"}], "answerId": "b", "explanation": "拓展字「哭」讀 kū，聲母 k 要送氣；gū 和 hū 的開頭不同。", "difficulty": 2},
      {"id": "p9-s10", "type": "sound", "focus": "g、k、h 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "開", "pinyin": "kāi"}, "options": [{"id": "a", "label": "kāi"}, {"id": "b", "label": "gāi"}, {"id": "c", "label": "hāi"}], "answerId": "a", "explanation": "拓展字「開」讀 kāi，開頭是送氣的 k，不是 g，也不是摩擦音 h。", "difficulty": 2}
    ],
    dictationBank: [
      {"char": "煮", "pinyin": "zhǔ", "word": "煮飯", "accept": ["煮"]},
      {"char": "豆", "pinyin": "dòu", "word": "豆子", "accept": ["豆"]},
      {"char": "汁", "pinyin": "zhī", "word": "果汁", "accept": ["汁"]},
      {"char": "作", "pinyin": "zuò", "word": "工作", "accept": ["作"]},
      {"char": "燃", "pinyin": "rán", "word": "燃燒", "accept": ["燃"]},
      {"char": "泣", "pinyin": "qì", "word": "哭泣", "accept": ["泣"]},
      {"char": "根", "pinyin": "gēn", "word": "樹根", "accept": ["根"]},
      {"char": "煎", "pinyin": "jiān", "word": "煎蛋", "accept": ["煎"]},
      {"char": "急", "pinyin": "jí", "word": "急忙", "accept": ["急"]}
    ]
  },
  'jue-ju': {
    grade: 4,
    idPrefix: "p10",
    title: "草堂窗外的畫",
    curriculum: {"unit": 2, "lesson": 3, "focus": "複習韻母 u、ua、uo", "sampled": ["u", "uo"], "notSampled": ["ua", "零聲母音節 wu、wa 的寫法"], "source": "概覽：四年級第一學段第二單元第三課；教材照片 4-3.1（第20頁）。"},
    items: [
      {"id": "p10-s1", "type": "sound", "focus": "u", "prompt": "「白鷺」的「鷺」，韻母是哪一個？", "audio": {"char": "鷺", "pinyin": "lù"}, "options": [{"id": "a", "label": "ua"}, {"id": "b", "label": "u"}, {"id": "c", "label": "uo"}], "answerId": "b", "explanation": "「白鷺」的「鷺」讀 lù，韻母是 u。白鷺是白羽、長腳、尖嘴的水鳥。"},
      {"id": "p10-d1", "type": "dictation", "prompt": "聽一聽，寫出指定的字。", "audio": {"text": "請寫出「翠綠」的「翠」。", "char": "翠", "pinyin": "cuì"}, "target": {"char": "翠", "pinyin": "cuì", "accept": ["翠"]}, "explanation": "翠綠的「翠」，上面是「羽」，下面是「卒」。詩中的「翠柳」就是翠綠的柳枝。"},
      {"id": "p10-s2", "type": "sound", "focus": "uo", "prompt": "「三國」的「國」，韻母是哪一個？仔細聽，再放入貨架。", "audio": {"char": "國", "pinyin": "guó"}, "options": [{"id": "a", "label": "uo"}, {"id": "b", "label": "u"}, {"id": "c", "label": "ua"}], "answerId": "a", "explanation": "拓展字「國」讀 guó，韻母是 uo。詩中的「東吳」，泛指三國時代吳國的屬地。"},
      {"id": "p10-d2", "type": "dictation", "prompt": "聽一聽，寫出指定的字。", "audio": {"text": "請寫出「停泊」的「泊」。", "char": "泊", "pinyin": "bó"}, "target": {"char": "泊", "pinyin": "bó", "accept": ["泊"]}, "explanation": "停泊的「泊」，左邊是三點水。「門泊」的「泊」讀 bó，意思是停船靠岸。"},
      {"id": "p10-m1", "type": "match", "prompt": "從草堂望出去，景物有遠有近。把三張畫卡放到近景、中景、遠景的位置。", "cards": [{"id": "a", "label": "黃鸝鳴柳", "image": "media/jue-ju/scene-1.webp"}, {"id": "b", "label": "西嶺積雪", "image": "media/jue-ju/scene-3.webp"}, {"id": "c", "label": "江上泊船", "image": "media/jue-ju/scene-4.webp"}], "slots": [{"id": "one", "label": "遠景", "accepts": "b"}, {"id": "two", "label": "近景", "accepts": "a"}, {"id": "three", "label": "中景", "accepts": "c"}], "explanation": "黃鸝在窗前的柳枝上鳴叫，是近景；江上停泊的船是中景；終年積雪的西嶺最遠，是遠景。遠近景物交相映襯，像一幅層次分明的圖畫。"}
    ],
    moreSounds: [
      {"id": "p10-s3", "type": "sound", "focus": "u", "prompt": "聽清楚，找出這個字的韻母。", "audio": {"char": "吳", "pinyin": "wú"}, "options": [{"id": "a", "label": "u"}, {"id": "b", "label": "ua"}, {"id": "c", "label": "uo"}], "answerId": "a", "explanation": "「東吳」的「吳」讀 wú，韻母是 u。u 前面沒有聲母時，音節寫成 wu。"},
      {"id": "p10-s4", "type": "sound", "focus": "ua", "prompt": "聽清楚，找出這個字的韻母。", "audio": {"char": "畫", "pinyin": "huà"}, "options": [{"id": "a", "label": "uo"}, {"id": "b", "label": "ua"}, {"id": "c", "label": "u"}], "answerId": "b", "explanation": "拓展字「畫」讀 huà，韻母是 ua。賞析說杜甫用詩的語言「畫」出了四種景物。"}
    ],
    variedSounds: [
      {"id": "p10-s5", "type": "sound", "focus": "u", "prompt": "聽清楚，找出這個字的韻母。", "audio": {"char": "圖", "pinyin": "tú"}, "options": [{"id": "a", "label": "ua"}, {"id": "b", "label": "uo"}, {"id": "c", "label": "u"}], "answerId": "c", "explanation": "拓展字「圖」讀 tú，韻母是 u。這首詩寫的景物，就像一幅層次分明的圖畫。"},
      {"id": "p10-s6", "type": "sound", "focus": "uo", "prompt": "聽清楚，找出這個字的韻母。", "audio": {"char": "錯", "pinyin": "cuò"}, "options": [{"id": "a", "label": "u"}, {"id": "b", "label": "uo"}, {"id": "c", "label": "ua"}], "answerId": "b", "explanation": "拓展字「錯」讀 cuò，韻母是 uo。賞析說詩中景物「錯落有致」，遠近高低安排得很好。"},
      {"id": "p10-s7", "type": "sound", "focus": "u、uo 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "鷺", "pinyin": "lù"}, "options": [{"id": "a", "label": "luò"}, {"id": "b", "label": "lù"}], "answerId": "b", "explanation": "「白鷺」的「鷺」讀 lù，韻母是 u；luò 的韻母是 uo。兩個選項聲母、聲調相同，韻母不同，要聽清楚。", "difficulty": 2},
      {"id": "p10-s8", "type": "sound", "focus": "u、ua、uo 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "畫", "pinyin": "huà"}, "options": [{"id": "a", "label": "hù"}, {"id": "b", "label": "huà"}, {"id": "c", "label": "huò"}], "answerId": "b", "explanation": "拓展字「畫」讀 huà，韻母是 ua；hù 的韻母是 u，huò 的韻母是 uo。三個選項聲母、聲調相同，韻母不同。", "difficulty": 2},
      {"id": "p10-s9", "type": "sound", "focus": "零聲母 u 的寫法", "prompt": "聽一聽，「吳」的拼音應怎樣寫？", "audio": {"char": "吳", "pinyin": "wú"}, "options": [{"id": "a", "label": "ú"}, {"id": "b", "label": "wó"}, {"id": "c", "label": "wú"}], "answerId": "c", "explanation": "「東吳」的「吳」讀 wú。韻母 u 單獨成音節時，前面要加 w，寫作 wu。", "difficulty": 2},
      {"id": "p10-s10", "type": "sound", "focus": "u、ua、uo 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "過", "pinyin": "guò"}, "options": [{"id": "a", "label": "guò"}, {"id": "b", "label": "gù"}, {"id": "c", "label": "guà"}], "answerId": "a", "explanation": "拓展字「過」讀 guò，韻母是 uo；gù 的韻母是 u，guà 的韻母是 ua。聽清從 u 滑向 o 的聲音。", "difficulty": 2}
    ],
    dictationBank: [
      {"char": "鳴", "pinyin": "míng", "word": "鳴叫", "accept": ["鳴", "鸣"]},
      {"char": "翠", "pinyin": "cuì", "word": "翠綠", "accept": ["翠"]},
      {"char": "柳", "pinyin": "liǔ", "word": "柳樹", "accept": ["柳"]},
      {"char": "鷺", "pinyin": "lù", "word": "白鷺", "accept": ["鷺", "鹭"]},
      {"char": "窗", "pinyin": "chuāng", "word": "窗戶", "accept": ["窗"]},
      {"char": "含", "pinyin": "hán", "word": "包含", "accept": ["含"]},
      {"char": "雪", "pinyin": "xuě", "word": "積雪", "accept": ["雪"]},
      {"char": "泊", "pinyin": "bó", "word": "停泊", "accept": ["泊"]},
      {"char": "船", "pinyin": "chuán", "word": "船隻", "accept": ["船"]}
    ]
  },
  'zheng-ren-mai-lu': {
    grade: 5,
    idPrefix: "p11",
    title: "市集買鞋記",
    curriculum: {"unit": 2, "lesson": 3, "focus": "分辨聲母 n、l", "sampled": ["n", "l"], "notSampled": ["句子中的 n、l 連續辨讀及口語產出"], "source": "概覽：五年級第一學段第二單元第三課；教材照片 5-3.1（第20頁）。兩道聽辨只記錄辨認表現，不能推斷實際發音能力。"},
    items: [
      {"id": "p11-s1", "type": "sound", "focus": "n", "prompt": "只靠耳朵找聲母：這個聲音應放到哪一格？", "audio": {"char": "寧", "pinyin": "nìng"}, "options": [{"id": "a", "label": "l"}, {"id": "b", "label": "n"}], "answerId": "b", "explanation": "聽到的是「寧信度」的「寧」nìng，聲母是鼻音 n；拓展字「另」lìng 的聲母是 l。n 的氣流經鼻腔發出。"},
      {"id": "p11-d1", "type": "dictation", "prompt": "聽一聽，寫出指定的字。", "audio": {"text": "請寫出「鞋履」的「履」。", "char": "履", "pinyin": "lǚ"}, "target": {"char": "履", "pinyin": "lǚ", "accept": ["履"]}, "explanation": "鞋履的「履」，上面是「尸」，裏面是「復」。文中的「履」就是鞋子。"},
      {"id": "p11-s2", "type": "sound", "focus": "l", "prompt": "留意字音的開頭，這次應放到哪一格？", "audio": {"char": "履", "pinyin": "lǚ"}, "options": [{"id": "a", "label": "l"}, {"id": "b", "label": "n"}], "answerId": "a", "explanation": "「履」讀 lǚ，聲母是邊音 l，氣流從舌頭兩側通過。不要和聲母是 n 的「女」nǚ 混淆。"},
      {"id": "p11-d2", "type": "dictation", "prompt": "聽一聽，寫出指定的字。", "audio": {"text": "請寫出「試穿」的「試」。", "char": "試", "pinyin": "shì"}, "target": {"char": "試", "pinyin": "shì", "accept": ["試", "试"]}, "explanation": "試穿的「試」，左邊是言字旁。「何不試之以足」是問他：為甚麼不用自己的腳去試鞋？"},
      {"id": "p11-m1", "type": "sequence", "prompt": "鄭人買鞋發生了甚麼事？把四張故事卡依次放好。", "cards": [{"id": "a", "label": "量好腳，把尺寸放在座位上", "image": "media/zheng-ren-mai-lu/scene-1.webp"}, {"id": "b", "label": "挑好鞋，才發現忘了帶尺寸", "image": "media/zheng-ren-mai-lu/scene-2.webp"}, {"id": "c", "label": "回家取尺寸，市集已散", "image": "media/zheng-ren-mai-lu/scene-3.webp"}, {"id": "d", "label": "有人勸他用腳試鞋", "image": "media/zheng-ren-mai-lu/scene-4.webp"}], "slots": [{"id": "one", "label": "先", "accepts": "a"}, {"id": "two", "label": "接着", "accepts": "b"}, {"id": "three", "label": "然後", "accepts": "c"}, {"id": "four", "label": "最後", "accepts": "d"}], "explanation": "鄭人先量好腳，把尺寸擱在座位上；到了市集挑好鞋，才發現忘了帶；回家取尺寸，回來時市集已散；有人勸他用腳試鞋，他仍寧信尺寸。"}
    ],
    moreSounds: [
      {"id": "p11-s3", "type": "sound", "focus": "n", "prompt": "聽開頭，找出這個字的聲母。", "audio": {"char": "乃", "pinyin": "nǎi"}, "options": [{"id": "a", "label": "n"}, {"id": "b", "label": "l"}], "answerId": "a", "explanation": "「乃曰」的「乃」讀 nǎi，聲母是 n。讀 n 時，氣流經鼻腔發出。"},
      {"id": "p11-s4", "type": "sound", "focus": "l", "prompt": "聽開頭，找出這個字的聲母。", "audio": {"char": "量", "pinyin": "liáng"}, "options": [{"id": "a", "label": "n"}, {"id": "b", "label": "l"}], "answerId": "b", "explanation": "拓展字「量」讀 liáng，就是量腳的「量」。聲母是 l，氣流從舌頭兩側通過。"}
    ],
    variedSounds: [
      {"id": "p11-s5", "type": "sound", "focus": "n", "prompt": "聽開頭，找出這個字的聲母。", "audio": {"char": "拿", "pinyin": "ná"}, "options": [{"id": "a", "label": "l"}, {"id": "b", "label": "n"}], "answerId": "b", "explanation": "拓展字「拿」讀 ná，聲母是 n。文中的「操」和「持」，都是拿取的意思。"},
      {"id": "p11-s6", "type": "sound", "focus": "l", "prompt": "聽開頭，找出這個字的聲母。", "audio": {"char": "靈", "pinyin": "líng"}, "options": [{"id": "a", "label": "l"}, {"id": "b", "label": "n"}], "answerId": "a", "explanation": "拓展字「靈」讀 líng，聲母是 l，不是鼻音 n。故事提醒我們做事要靈活變通。"},
      {"id": "p11-s7", "type": "sound", "focus": "n、l 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "寧", "pinyin": "nìng"}, "options": [{"id": "a", "label": "lìng"}, {"id": "b", "label": "nìng"}], "answerId": "b", "explanation": "「寧信度」的「寧」讀 nìng；拓展字「另」讀 lìng。韻母和聲調相同，要聽清鼻音 n 和邊音 l。", "difficulty": 2},
      {"id": "p11-s8", "type": "sound", "focus": "n、l 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "履", "pinyin": "lǚ"}, "options": [{"id": "a", "label": "lǚ"}, {"id": "b", "label": "nǚ"}], "answerId": "a", "explanation": "「履」讀 lǚ，拓展字「女」讀 nǚ。這次聽到的是邊音 l。", "difficulty": 2},
      {"id": "p11-s9", "type": "sound", "focus": "n、l 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "量", "pinyin": "liáng"}, "options": [{"id": "a", "label": "niáng"}, {"id": "b", "label": "liáng"}], "answerId": "b", "explanation": "拓展字「量」讀 liáng，「娘」讀 niáng。量腳的「量」，開頭是邊音 l。", "difficulty": 2},
      {"id": "p11-s10", "type": "sound", "focus": "n、l 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "腦", "pinyin": "nǎo"}, "options": [{"id": "a", "label": "nǎo"}, {"id": "b", "label": "lǎo"}], "answerId": "a", "explanation": "拓展字「腦」讀 nǎo，「老」讀 lǎo。動動腦筋、懂得變通的「腦」，開頭是鼻音 n。", "difficulty": 2}
    ],
    dictationBank: [
      {"char": "履", "pinyin": "lǚ", "word": "鞋履", "accept": ["履"]},
      {"char": "置", "pinyin": "zhì", "word": "購置", "accept": ["置"]},
      {"char": "度", "pinyin": "dù", "word": "尺度", "accept": ["度"]},
      {"char": "市", "pinyin": "shì", "word": "市集", "accept": ["市"]},
      {"char": "忘", "pinyin": "wàng", "word": "忘記", "accept": ["忘"]},
      {"char": "持", "pinyin": "chí", "word": "堅持", "accept": ["持"]},
      {"char": "罷", "pinyin": "bà", "word": "罷休", "accept": ["罷", "罢"]},
      {"char": "寧", "pinyin": "nìng", "word": "寧可", "accept": ["寧", "宁"]},
      {"char": "試", "pinyin": "shì", "word": "試穿", "accept": ["試", "试"]}
    ]
  },
  'ke-zhi': {
    grade: 6,
    idPrefix: "p12",
    title: "草堂迎客記",
    curriculum: {"unit": 2, "lesson": 3, "focus": "分辨聲母 x、s、sh", "sampled": ["x", "s"], "notSampled": ["sh 的獨立聽辨", "x 與 ü 行韻母相拼的省點規則"], "source": "概覽：六年級第一學段第二單元第三課；教材照片 6-3.1（第20頁）。sh 作干擾項不等於已獨立考查 sh。"},
    items: [
      {"id": "p12-s1", "type": "sound", "focus": "x", "prompt": "不看漢字，只聽開頭。這個字的聲母是哪一個？", "audio": {"char": "相", "pinyin": "xiāng"}, "options": [{"id": "a", "label": "s"}, {"id": "b", "label": "sh"}, {"id": "c", "label": "x"}], "answerId": "c", "explanation": "聽到的是「相對飲」的「相」xiāng，聲母是舌面音 x。「商」shāng 用的是翹舌音 sh，兩個字的聲母不同。"},
      {"id": "p12-d1", "type": "dictation", "prompt": "聽一聽，寫出指定的字。", "audio": {"text": "請寫出「鄰居」的「鄰」。", "char": "鄰", "pinyin": "lín"}, "target": {"char": "鄰", "pinyin": "lín", "accept": ["鄰", "邻"]}, "explanation": "鄰居的「鄰」，右邊是「阝」。詩人隔着籬笆，把鄰居老翁請來一同歡聚。"},
      {"id": "p12-s2", "type": "sound", "focus": "s", "prompt": "再分辨一次：把聽到的聲音送到合適的聲母貨架。", "audio": {"char": "掃", "pinyin": "sǎo"}, "options": [{"id": "a", "label": "sh"}, {"id": "b", "label": "s"}, {"id": "c", "label": "x"}], "answerId": "b", "explanation": "聽到的是「掃」sǎo，聲母是平舌音 s；「少」shǎo 的聲母才是翹舌音 sh。"},
      {"id": "p12-d2", "type": "dictation", "prompt": "聽一聽，寫出指定的字。", "audio": {"text": "請寫出「籬笆」的「籬」。", "char": "籬", "pinyin": "lí"}, "target": {"char": "籬", "pinyin": "lí", "accept": ["籬", "篱"]}, "explanation": "籬笆的「籬」，上面是竹字頭。「隔籬」就是隔着籬笆，詩人就在籬笆邊招呼鄰居。"},
      {"id": "p12-m1", "type": "sequence", "prompt": "詩人怎樣迎接和招待客人？把三張故事卡依次放好。", "cards": [{"id": "a", "label": "打開蓬門迎客", "image": "media/ke-zhi/scene-2.webp"}, {"id": "b", "label": "家常酒菜待客", "image": "media/ke-zhi/scene-3.webp"}, {"id": "c", "label": "隔籬呼喚鄰翁", "image": "media/ke-zhi/scene-4.webp"}], "slots": [{"id": "one", "label": "先", "accepts": "a"}, {"id": "two", "label": "接着", "accepts": "b"}, {"id": "three", "label": "最後", "accepts": "c"}], "explanation": "詩人先打掃花徑、打開蓬門迎接崔明府，接着端出簡樸的家常酒菜款待，最後隔着籬笆請鄰居老翁一同歡聚，氣氛越來越熱鬧。"}
    ],
    moreSounds: [
      {"id": "p12-s3", "type": "sound", "focus": "sh", "prompt": "聽開頭，找出這個字的聲母。", "audio": {"char": "市", "pinyin": "shì"}, "options": [{"id": "a", "label": "x"}, {"id": "b", "label": "s"}, {"id": "c", "label": "sh"}], "answerId": "c", "explanation": "「市遠」的「市」讀 shì，指市集，聲母是翹舌音 sh，舌尖輕輕翹起。"},
      {"id": "p12-s4", "type": "sound", "focus": "s", "prompt": "聽開頭，找出這個字的聲母。", "audio": {"char": "飧", "pinyin": "sūn"}, "options": [{"id": "a", "label": "s"}, {"id": "b", "label": "sh"}, {"id": "c", "label": "x"}], "answerId": "a", "explanation": "「盤飧」的「飧」讀 sūn，聲母是平舌音 s。它指熟食，字形像「餐」，卻不讀 cān。"}
    ],
    variedSounds: [
      {"id": "p12-s5", "type": "sound", "focus": "x", "prompt": "聽開頭，找出這個字的聲母。", "audio": {"char": "喜", "pinyin": "xǐ"}, "options": [{"id": "a", "label": "sh"}, {"id": "b", "label": "x"}, {"id": "c", "label": "s"}], "answerId": "b", "explanation": "拓展字「喜」讀 xǐ，聲母是舌面音 x。客人來訪，詩人喜出望外。"},
      {"id": "p12-s6", "type": "sound", "focus": "sh", "prompt": "聽開頭，找出這個字的聲母。", "audio": {"char": "水", "pinyin": "shuǐ"}, "options": [{"id": "a", "label": "sh"}, {"id": "b", "label": "x"}, {"id": "c", "label": "s"}], "answerId": "a", "explanation": "「春水」的「水」讀 shuǐ，聲母是翹舌音 sh。"},
      {"id": "p12-s7", "type": "sound", "focus": "x、s、sh 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "相", "pinyin": "xiāng"}, "options": [{"id": "a", "label": "xiāng"}, {"id": "b", "label": "sāng"}, {"id": "c", "label": "shāng"}], "answerId": "a", "explanation": "「相對飲」的「相」讀 xiāng，聲母是舌面音 x；sāng 的聲母是 s，shāng 的聲母是 sh。", "difficulty": 2},
      {"id": "p12-s8", "type": "sound", "focus": "s、sh 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "掃", "pinyin": "sǎo"}, "options": [{"id": "a", "label": "shǎo"}, {"id": "b", "label": "sǎo"}], "answerId": "b", "explanation": "「掃」讀 sǎo，「少」讀 shǎo。韻母和聲調相同，要分辨平舌音和翹舌音。", "difficulty": 2},
      {"id": "p12-s9", "type": "sound", "focus": "x、s、sh 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "舍", "pinyin": "shè"}, "options": [{"id": "a", "label": "sè"}, {"id": "b", "label": "xiè"}, {"id": "c", "label": "shè"}], "answerId": "c", "explanation": "「舍南舍北」的「舍」讀 shè，聲母是 sh；不要讀成「色」sè 或「謝」xiè。", "difficulty": 2},
      {"id": "p12-s10", "type": "sound", "focus": "x、s、sh 聽辨", "prompt": "仔細聽，哪個拼音和聲音一樣？", "audio": {"char": "始", "pinyin": "shǐ"}, "options": [{"id": "a", "label": "sǐ"}, {"id": "b", "label": "shǐ"}, {"id": "c", "label": "xǐ"}], "answerId": "b", "explanation": "「今始為君開」的「始」讀 shǐ，聲母是翹舌音 sh；sǐ 是平舌音 s，xǐ 是舌面音 x。", "difficulty": 2}
    ],
    dictationBank: [
      {"char": "鷗", "pinyin": "ōu", "word": "海鷗", "accept": ["鷗", "鸥"]},
      {"char": "徑", "pinyin": "jìng", "word": "花徑", "accept": ["徑", "径"]},
      {"char": "曾", "pinyin": "céng", "word": "曾經", "accept": ["曾"]},
      {"char": "掃", "pinyin": "sǎo", "word": "打掃", "accept": ["掃", "扫"]},
      {"char": "貧", "pinyin": "pín", "word": "貧窮", "accept": ["貧", "贫"]},
      {"char": "舊", "pinyin": "jiù", "word": "新舊", "accept": ["舊", "旧"]},
      {"char": "鄰", "pinyin": "lín", "word": "鄰居", "accept": ["鄰", "邻"]},
      {"char": "籬", "pinyin": "lí", "word": "籬笆", "accept": ["籬", "篱"]},
      {"char": "杯", "pinyin": "bēi", "word": "酒杯", "accept": ["杯"]}
    ]
  }
};
