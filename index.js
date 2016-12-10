import R from 'ramda';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';


/* ----------- DATA PROCESSING ----------- */


/**
 * A regex fragment that matches any character which does not contirbute
 * to the meaning of a product label (model/family).
 */
const nonLabelChar = '[^a-z0-9]';

const removeNonLabelChars = R.replace(new RegExp(nonLabelChar, 'i'), '');
const splitCharacters = R.split('');
const joinWithOptionalNonLabelChar = R.join(`${nonLabelChar}?`);

/**
 * Creates a regex fragment which will match strings that have the label in
 * them, allowing for punctuation or indiviual spaces to be added or removed.
 */
const matchAnyPunctuation = R.compose(
  joinWithOptionalNonLabelChar,
  splitCharacters,
  removeNonLabelChars,
);

/**
 * Creates a regex which is used to determine if a lebel is present.
 * If there are characters immediately before or after the label, they must not
 * be characters which could be part of a label.
 */
const makeLabelRegex = label => new RegExp(
  `^(?:.*${nonLabelChar})?${matchAnyPunctuation(label)}(?:${nonLabelChar}.*)?$`,
  'i',
);

const manufacturerRegexTest = ({ manufacturer }) => R.compose(
  R.test(new RegExp(`^${manufacturer}$`, 'i')),
  R.prop('manufacturer'),
);

const modelRegexTest = ({ model }) => R.compose(
  R.test(makeLabelRegex(model)),
  R.prop('title'),
);

const familyRegexTest = ({ family }) => R.compose(
  R.test(family ? makeLabelRegex(family) : /(?:)/),
  R.prop('title'),
);

const naiveMatching = product => R.allPass([
  manufacturerRegexTest(product),
  modelRegexTest(product),
  familyRegexTest(product),
]);

// const mergeInMatchedListings = product => R.compose(
//   R.merge,
//   R.objOf('listings'),
//   R.filter(naiveMatching(product)),
// );

const makeFilteredListingsObject = product => R.compose(
  R.objOf('listings'),
  R.filter(naiveMatching(product)),
);


const augmentProductWithListings = listings => product => R.merge(
  makeFilteredListingsObject(product)(listings),
  product,
);

/**
 * Returns an array of products which have been augmented with an array of
 * listings according to the following heuristic:
 *  - the listing's manufacturer exactly matches the product's manufacturer,
 *    ignoring case.
 *  - the listing's title contains the product's model, allowing for punctuation
 *    and case differences.
 *  - if the product has a famliy, the listings's title contains it, allowing
 *    for punctuation and case differences.
 *
 * @param {[Product]} products
 * @param {[Listing]} listings
 * @returns {[Product]}
 */

const resultsProperties = ['product_name', 'listings'];

const generateResults = ({ products, listings }) =>
  products
    .map(augmentProductWithListings(listings))
    .map(R.pick(resultsProperties));


/* ----------- ENTRY POINT / FILE PROCESSING ----------- */


(() => {
  const inputFiles = {
    products: {
      fileName: 'products.txt',
      data: [],
    },
    listings: {
      fileName: 'listings.txt',
      data: [],
    },
  };
  const resultsFile = 'results.txt';
  const resultsWriteStream = createWriteStream(resultsFile);
  const totalReaderCount = R.keys(inputFiles).length;
  let closedReaderCount = 0;

  const handleReaderClosed = () => {
    closedReaderCount += 1;

    if (closedReaderCount === totalReaderCount) {
      const data = R.map(R.prop('data'), inputFiles);

      generateResults(data).forEach(result =>
        resultsWriteStream.write(`${JSON.stringify(result)}\n`),
      );
    }
  };

  R.values(inputFiles).forEach(({ fileName, data }) => {
    createInterface({ input: createReadStream(fileName) })
      .on('line', line => data.push(JSON.parse(line)))
      .on('close', handleReaderClosed);
  });
})();
