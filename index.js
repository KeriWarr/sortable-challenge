import R from 'ramda';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';

/* ----------- DATA PROCESSING ----------- */

const resultsProperties = ['product_name', 'listings'];

// encapsulate business logic inside IIFE
const generateResults = (() => {
  /**
   * A regex fragment that matches any character which does not contirbute
   * to the meaning of a product label (model/family).
   */
  const nonLabelChar = '[^a-z0-9.]';

  /**
   * String -> String
   *
   * Creates a regex fragment which will match strings that have the label in
   * them, allowing for punctuation or indiviual spaces to be added or removed.
   */
  const matchAnyPunctuation = R.compose(
    R.join(`${nonLabelChar}?`),
    R.split(''),
    R.replace(new RegExp(nonLabelChar, 'i'), ''),
  );

  /**
   * String -> RegExp
   *
   * Creates a regex which is used to determine if a lebel is present.
   * If there are characters immediately before or after the label, they must
   * not be characters which could be part of a label.
   */
  const makeLabelRegex = label => new RegExp(
    `^(?:.*${nonLabelChar})?${matchAnyPunctuation(label)}(?:${nonLabelChar}.*)?$`,
    'i',
  );

  /**
   * Product -> Listing -> Boolean
   *
   * Tests that the listing's manufacturer matches the product's manufacturer.
   */
  const manufacturerRegexTest = ({ manufacturer }) => R.compose(
    R.test(new RegExp(`^${manufacturer}$`, 'i')),
    R.prop('manufacturer'),
  );

  /**
   * Product -> Listing -> Boolean
   *
   * Tests that the listing's title contains the product's model.
   */
  const modelRegexTest = ({ model }) => R.compose(
    R.test(makeLabelRegex(model)),
    R.prop('title'),
  );

  /**
   * Product -> Listing -> Boolean
   *
   * Tests that if[^a-z0-9] the product has a famliy, the listings's title contains it.
   */
  const familyRegexTest = ({ family }) => R.compose(
    R.test(family ? makeLabelRegex(family) : /(?:)/),
    R.prop('title'),
  );

  /**
   * Product -> Listing -> Boolean
   */
  const similarModelTest = ({ similarModels }) => R.compose(
    R.not,
    R.anyPass(similarModels.map(model => R.test(makeLabelRegex(model)))),
    R.prop('title'),
  );

  /**
   * Product -> Listing -> Boolean
   *
   * For a given (Product, Listing) pair - return true iff all three of the
   * given tests pass.
   */
  const naiveMatching = product => listing =>
    R.allPass([
      manufacturerRegexTest(product),
      modelRegexTest(product),
      familyRegexTest(product),
      // similarModelTest(product),
    ])(listing);

  /**
   * [Listing] -> Product -> Product'
   *
   * returns a product that has been augmented with all listings that naively
   * match it.
   */
  const augmentWithNaiveListings = R.curry((listings, product) =>
    Object.assign({}, {
      listings: listings.filter(naiveMatching(product)),
    }, product),
  );

  /**
   * [Product] -> Product -> Product
   *
   * Returns a product that has been augmented with all other product models
   * for which this product's model might be mistaken
   *
   * e.g. a listing for a model that is a superstring this products model would
   * otherwise be recognized as belonging to this model.
   */
  const findSimilarModels = R.curry((products, product) =>
    Object.assign({}, {
      similarModels: products
        .filter(p =>
          (product.model !== p.model) &&
          (R.test(makeLabelRegex(product.model), p.model)))
        .map(p => p.model),
    }, product),
  );

  /**
   * [Listing] -> Product' -> Product''
   */
  const findSimilarListings = R.curry((listings, product) =>
    product,
  );

  /**
   * Product'' -> Product'''
   */
  const filterOutlierListings = product => product;

  /**
   * Consumes the products and listings, and outputs results in the specified
   * shape, after applying a number of tests and heuristics.
   *
   * @param {[Product]} products
   * @param {[Listing]} listings
   * @returns {[Result]}
   */
  return ({ products, listings }) =>
    products
      // .map(findSimilarModels(products))
      .map(augmentWithNaiveListings(listings))
      // .map(findSimilarListings(listings))
      // .map(filterOutlierListings)
      .map(R.pick(resultsProperties));
})();


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
