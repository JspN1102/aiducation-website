'use strict';
// Every poem pupils can open: the first six (poems.json) and round two, 7-12
// (poems-preview.json). Server checks and teacher tools read this list.
const poems=[...require('../../maanshan/poems.json').poems,...require('../../maanshan/poems-preview.json').poems];
module.exports={poems};
