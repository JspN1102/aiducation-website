import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mapAssessment} from '../maanshan/core.mjs';
import {configurePronunciation, getPronunciationPractice, syllableParts, toneName, writtenSyllable} from '../maanshan/pronunciation.mjs';

const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const poemData = read('../maanshan/poems.json');
const poems = Array.isArray(poemData) ? poemData : poemData.poems;
const readings = read('./fixtures/soe-model-readings.json').readings;
configurePronunciation(read('../maanshan/pronunciation.json'));

// An assessment in the provider's shape; phones are [label, score] pairs.
const raw = words => ({PronAccuracy:80, SuggestedScore:80, PronFluency:0.9, PronCompletion:1, Words:words.map(([Word, PronAccuracy, MatchTag, phones]) => ({Word, PronAccuracy, MatchTag, PhoneInfos:phones.map(([Phone, score]) => ({Phone, PronAccuracy:score}))}))});
const poem = id => poems.find(entry => entry.id === id);
const assess = (id, lineIndex, words) => {
  const line = poem(id).lines[lineIndex];
  return {line, result:mapAssessment(raw(words), line)};
};
const wordFor = (result, char) => result.words.find(word => word.c === char);

test('written syllables follow the classroom split of initial, final and tone', () => {
  assert.deepEqual(writtenSyllable('yuǎn'), {initial:'y', final:'üan', tone:3});
  assert.deepEqual(writtenSyllable('qū'), {initial:'q', final:'ü', tone:1});
  assert.deepEqual(writtenSyllable('shuǐ'), {initial:'sh', final:'ui', tone:3});
  assert.deepEqual(writtenSyllable('é'), {initial:'', final:'e', tone:2});
  assert.equal(toneName(4), '第四聲');
});

test('the demonstration voice reading every course line raises no false tone error', () => {
  let assessed = 0;
  for (const reading of readings) {
    const line = poem(reading.grade).lines[reading.line];
    const result = mapAssessment(raw(reading.words), line);
    assert.equal(result.words.length, Array.from(line.text).filter(char => /\p{Script=Han}/u.test(char)).length, `${line.text} keeps one entry per character`);
    for (const word of result.words) {
      const parts = syllableParts(word, line);
      assert(parts, `${word.c} has parts`);
      assert.notEqual(parts.tone.state, 'miss', `${word.c} (${word.p}) heard tone ${parts.tone.heard}`);
      assert.notEqual(parts.tone.state, 'unknown', `${word.c} reports the heard tone`);
      assessed++;
    }
    const practice = getPronunciationPractice({words:result.words.map(word => ({...word, lineIndex:reading.line}))}, poem(reading.grade));
    for (const item of practice.items) assert.notEqual(item.evidence.kind, 'tone', `${item.char} is not listed for its tone`);
  }
  assert.equal(assessed, 170);
});

test('tone sandhi is accepted but a different tone is named', () => {
  // 天街小雨潤如酥: 小 before the third tone of 雨 may rise.
  const {line, result} = assess(6, 0, [['天',98,0,[['t',98],['i1',98],['an',98]]], ['街',98,0,[['j',98],['i1',98],['e',98]]], ['小',95,0,[['x',95],['i2',95],['ao',95]]], ['雨',92,0,[['y',95],['v2',92]]], ['润',90,0,[['r',90],['un4',90]]], ['如',96,0,[['r',96],['u2',96]]], ['酥',97,0,[['s',97],['u1',97]]]]);
  assert.equal(syllableParts(wordFor(result, '小'), line).tone.state, 'ok');
  const rain = syllableParts(wordFor(result, '雨'), line);
  assert.deepEqual(rain.tone, {tone:3, heard:2, state:'miss'});
  assert.equal(rain.initial.state, 'ok');
  assert.equal(rain.final.state, 'ok');
  const item = getPronunciationPractice(result, poem(6)).items.find(entry => entry.char === '雨');
  assert(item, 'a high word score does not hide the wrong tone');
  assert.equal(item.issue, '聲調待改善');
  assert.equal(item.evidence.kind, 'tone');
  assert.match(item.explanation, /應讀第三聲，這次聽起來像第二聲/);
});

test('a weak final and a weak initial are told apart', () => {
  const {line, result} = assess(4, 0, [['京',55,0,[['j',92],['ing1',40]]], ['口',90,0,[['k',52],['ou3',95]]], ['瓜',98,0,[['g',98],['u1',98],['a',98]]], ['洲',98,0,[['zh',98],['ou1',98]]], ['一',96,0,[['y',96],['i4',96]]], ['水',97,0,[['sh',97],['ui3',97]]], ['间',98,0,[['j',98],['i1',98],['an',98]]]]);
  const jing = syllableParts(wordFor(result, '京'), line);
  assert.deepEqual([jing.initial.state, jing.final.state, jing.tone.state], ['ok', 'miss', 'ok']);
  assert.equal(jing.final.sound, 'ing');
  const kou = syllableParts(wordFor(result, '口'), line);
  assert.deepEqual([kou.initial.state, kou.final.state], ['miss', 'ok']);
  const items = getPronunciationPractice(result, poem(4)).items;
  assert.equal(items.find(entry => entry.char === '京').issue, '韻母待改善');
  assert.equal(items.find(entry => entry.char === '口').issue, '聲母待改善');
});

test('一 read with its own tone is not marked down for the final', () => {
  const {line, result} = assess(4, 0, [['京',98,0,[['j',98],['ing1',98]]], ['口',98,0,[['k',98],['ou3',98]]], ['瓜',98,0,[['g',98],['u1',98],['a',98]]], ['洲',98,0,[['zh',98],['ou1',98]]], ['一',59,0,[['y',96],['i1',22]]], ['水',97,0,[['sh',97],['ui3',97]]], ['间',98,0,[['j',98],['i1',98],['an',98]]]]);
  const one = syllableParts(wordFor(result, '一'), line);
  assert.deepEqual([one.initial.state, one.final.state, one.tone.state], ['ok', 'unknown', 'ok']);
  // Without its own y phone the shared initial is not judged either.
  const shared = syllableParts({...wordFor(result, '一'), phones:[{phone:'i1', score:22}]}, line);
  assert.deepEqual([shared.initial.state, shared.initial.shared, shared.final.state], ['unknown', true, 'unknown']);
  // 一 changes with the next syllable, but never to a third tone.
  const {line:springLine, result:springResult} = assess(6, 2, [['最',98,0,[['z',98],['ui4',98]]], ['是',98,0,[['sh',98],['i4',98]]], ['一',80,0,[['y',95],['i3',80]]], ['年',98,0,[['n',98],['i2',98],['an',98]]], ['春',98,0,[['ch',98],['un1',98]]], ['好',98,0,[['h',98],['ao3',98]]], ['处',98,0,[['ch',98],['u4',98]]]]);
  assert.equal(syllableParts(wordFor(springResult, '一'), springLine).tone.state, 'miss');
});

test('inserted words are dropped and missing words are flagged', () => {
  const {line, result} = assess(1, 1, [['曲',90,0,[['q',90],['v1',90]]], ['啊',60,1,[['a1',60]]], ['项',95,0,[['x',95],['i4',95],['ang',95]]], ['向',0,2,[]], ['天',99,0,[['t',99],['i1',99],['an',98]]], ['歌',99,0,[['g',98],['e1',99]]]]);
  assert.deepEqual(result.words.map(word => word.c), ['曲','項','向','天','歌']);
  assert.deepEqual(result.words.map(word => word.i), [0,1,2,3,4]);
  const missing = wordFor(result, '向');
  assert.equal(missing.missing, true);
  const parts = syllableParts(missing, line);
  assert.equal(parts.missing, true);
  assert.deepEqual([parts.initial.state, parts.final.state, parts.tone.state], ['unknown', 'unknown', 'unknown']);
  const item = getPronunciationPractice(result, poem(1)).items.find(entry => entry.char === '向');
  assert.equal(item.issue, '這個字沒有讀出來');
  assert.equal(wordFor(result, '曲').missing, undefined);
});

test('older results without phones or tags keep working', () => {
  const line = poem(1).lines[1];
  const result = mapAssessment({PronAccuracy:70, Words:[{Word:'曲', PronAccuracy:70}]}, line);
  assert.equal(result.words[0].missing, undefined);
  assert.equal(syllableParts(result.words[0], line), null);
  assert.equal(syllableParts({c:'曲', score:70}, line), null);
  const item = getPronunciationPractice(result, poem(1)).items[0];
  assert.equal(item.parts, null);
  assert.equal(item.evidence.level, 'word');
});
