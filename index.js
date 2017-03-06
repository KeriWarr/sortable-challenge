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

  const currencyConversion = {
    CAD: 1,
    USD: 1.21,
    GBP: 1.83,
    EUR: 1.37,
  };

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
    `^(?:.*${nonLabelChar})?${matchAnyPunctuation(label)}` +
    `(?:${nonLabelChar}.*)?$`,
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

  const lenientModelRegexTest = ({ model }) => R.compose(
    R.test(new RegExp(
      `^(?:.*${nonLabelChar})?${matchAnyPunctuation(model)}` +
      `${nonLabelChar}?[a-z]?(?:${nonLabelChar}.*)?$`,
      'i',
    )),
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
  const naiveMatching = product => R.allPass([
    manufacturerRegexTest(product),
    modelRegexTest(product),
    familyRegexTest(product),
    similarModelTest(product),
  ]);

  const ListingBonusRegex = /(\+\s*\w{2,}\s+\w{2,}| bag[ ,]| fototasche[, ]| with | w\/ | for ).*/;

  /**
   * [Listing] -> Product -> Product'
   *
   * returns a product that has been augmented with all listings that naively
   * match it.
   *
   * Modifies the working title of the listing such that suffixes such as:
   *   " + Accessory Kit for ... <model_names> ..." are removed.
   */
  const augmentWithNaiveListings = (listings) => {
    const workingListings = listings.map(listing => ({
      listing,
      manufacturer: listing.manufacturer,
      title: listing.title.replace(ListingBonusRegex, ''),
    }));

    return product => Object.assign({}, product, {
      listings: workingListings
        .filter(naiveMatching(product))
        .map(listing => listing.listing),
    });
  };

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
    Object.assign({}, product, {
      similarModels: products
        .filter(p =>
          (product.model !== p.model) &&
          (R.test(
            new RegExp(product.model.split('').join('.*'), 'i'),
            p.model,
          )),
        ).map(p => p.model),
    }),
  );

  const ListingRegex = /(\+\s*\w{2,}\s+\w{2,}| bag[ ,]| fototasche[, ]| for ).*/;
  const listingNumberRegex = /\d+(\.\d+)?/g;

  const extractListingNumbers = (title) => {
    const matches = [];
    let m;
    do {
      m = listingNumberRegex.exec(title);
      if (m) {
        matches.push(m[0]);
      }
    } while (m);
    return matches;
  };

  const includesRegex = (regex, list) => R.any(R.test(regex), list);

  const makeNumberRegex = (number) => {
    const prePeriod = number.replace(/[.,].*/, '');
    if (prePeriod.length >= 2) {
      return new RegExp(prePeriod);
    }
    return new RegExp(number.replace(/[.,]/g, '[.,]'));
  };

  const checkNumbersMatch = (originalNumbers, matchingNumbers, onlyCheckSubset) => {
    const originals = R.uniq(originalNumbers);
    const matchings = R.uniq(matchingNumbers);

    return (
      R.all(
        number => includesRegex(makeNumberRegex(number), matchings),
        originals,
      ) &&
      (onlyCheckSubset || R.all(
        number => includesRegex(makeNumberRegex(number), originals),
        matchings,
      ))
    );
  };

  /**
   * [Listing] -> Product' -> Product''
   */
  const findSimilarListings = R.curry((listings, product) => {
    if (product.listings.length < 3 || product.model.length < 3) {
      return product;
    }

    const productListingTitles = product.listings.map(
      listing => listing.title.replace(ListingRegex, ''),
    );
    const productListingNumbers = productListingTitles.map(
      extractListingNumbers,
    );

    if (productListingNumbers[0].length < 2) return product;

    const numbersMatch = R.all(
      numbers => checkNumbersMatch(numbers, productListingNumbers[0]),
      productListingNumbers.slice(1),
    );

    if (numbersMatch) {
      return Object.assign({}, product, {
        listings: product.listings.concat(listings.filter(
          R.allPass([
            R.compose(
              R.not,
              naiveMatching(product),
            ),
            R.allPass([
              manufacturerRegexTest(product),
              lenientModelRegexTest(product),
              similarModelTest(product),
              listing => checkNumbersMatch(
                productListingNumbers[0],
                extractListingNumbers(listing.title.replace(ListingRegex, '')),
                true,
              ),
            ]),
          ]),
        )),
      });
    }
    return product;
  });

  /**
   *
   */
  const getRelativePrice = listing =>
    parseFloat(listing.price * currencyConversion[listing.currency]);

  /**
   * Product'' -> Product'''
   */
  const filterOutlierListings = (product) => {
    const averagePrice = product.listings.reduce((sum, listing) =>
      sum + getRelativePrice(listing),
      0,
    ) / product.listings.length;

    return Object.assign({}, product, {
      listings: product.listings.filter(listing =>
        getRelativePrice(listing) > (averagePrice / 5),
      ),
    });
  };

  /**
   * Consumes the products and listings, and outputs results in the specified
   * shape, after applying a number of tests and heuristics.
   *
   * @param {[Product]} products
   * @param {[Listing]} listings
   * @returns {[Result]}
   */
  return ({ products, listings }) => products
    .map(findSimilarModels(products))
    .map(augmentWithNaiveListings(listings))
    .map(filterOutlierListings)
    .map(findSimilarListings(listings))
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
