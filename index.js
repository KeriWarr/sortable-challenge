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

  // Like the modelRegexTest except allows an extra trailing letter.
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
  const basicMatching = product => R.allPass([
    manufacturerRegexTest(product),
    modelRegexTest(product),
    familyRegexTest(product),
    similarModelTest(product),
  ]);

  /**
   * This regex is used to match suffixes of listings which contain data that
   * aren't useful for identifying the product.
   */
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
        .filter(basicMatching(product))
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

  /**
   * This regex is used to match suffixes of listings which contain data that
   * aren't useful for providing additional identification of the product.
   */
  const ListingRegex = /(\+\s*\w{2,}\s+\w{2,}| bag[ ,]| fototasche[, ]| for ).*/;
  // Matches numbers which may have a decimal in them
  const listingNumberRegex = /\d+(\.\d+)?/g;

  // Consumes a string and returns an array of number strings which it contains
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

  // Checks that an array includes a string which tests true for some regex.
  const includesRegex = (regex, list) => R.any(R.test(regex), list);

  /**
   * Constructs a RegExp using a number, which allows for european decimal
   * notation as well as rounding of sufficiently large numbers.
   */
  const makeNumberRegex = (number) => {
    const prePeriod = number.replace(/[.,].*/, '');
    if (prePeriod.length >= 2) {
      return new RegExp(prePeriod);
    }
    return new RegExp(number.replace(/[.,]/g, '[.,]'));
  };

  /**
   * Checks that the the two arrays of numbers are mutually inclusive.
   */
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
   * Compared to the basic matching test, this one doesn't check that the
   * listing contains the family of the product, it allows the model to have
   * an additional letter after it (colors) and it ensures that the new listing
   * contains all of the numbers that were found in the existing listings.
   */
  const lenientMatching = (product, numbers) => R.allPass([
    manufacturerRegexTest(product),
    lenientModelRegexTest(product),
    similarModelTest(product),
    listing => checkNumbersMatch(
      numbers,
      extractListingNumbers(listing.title.replace(ListingRegex, '')),
      true,
    ),
  ]);

  /**
   * [Listing] -> Product' -> Product''
   *
   * Finds other listings using the existing ones as a basis.
   * This is done by comparing the number values inside the existing listing
   * titles.
   */
  const findSimilarListings = R.curry((listings, product) => {
    // Not enough info to reliably detect similar models
    if (product.listings.length < 3 || product.model.length < 3) {
      return product;
    }

    // Remove extraneous data
    const productListingTitles = product.listings.map(
      listing => listing.title.replace(ListingRegex, ''),
    );
    // Extract number values from listing title
    const productListingNumbers = productListingTitles.map(
      extractListingNumbers,
    );

    if (productListingNumbers[0].length < 2) return product;

    const numbersMatch = R.all(
      numbers => checkNumbersMatch(numbers, productListingNumbers[0]),
      productListingNumbers.slice(1),
    );

    /**
     * If all the found listings contain numbers that are approximately
     * equivalent, find listings according to a more lenient test and
     * incorporate them.
     */
    if (numbersMatch) {
      return Object.assign({}, product, {
        listings: product.listings.concat(listings.filter(
          R.allPass([
            R.compose(
              R.not,
              basicMatching(product),
            ),
            lenientMatching(product, productListingNumbers[0]),
          ]),
        )),
      });
    }

    return product;
  });

  const currencyConversion = {
    CAD: 1,
    USD: 1.21,
    GBP: 1.83,
    EUR: 1.37,
  };

  /**
   * Listing -> Number
   *
   * Consumes a listing and returns a price for that listing, adjusted to
   * a common currency.
   */
  const getRelativePrice = listing =>
    parseFloat(listing.price * currencyConversion[listing.currency]);


  const belowPriceFactorThreshold = 5;

  /**
   * Product'' -> Product'''
   *
   * Removes all matched listings that have a price which is lower than
   * the average listing price by the given factor.
   *
   * This is useful for filtering out listings that are accessories.
   */
  const filterOutlierListings = (product) => {
    const averagePrice = product.listings.reduce((sum, listing) =>
      sum + getRelativePrice(listing),
      0,
    ) / product.listings.length;

    return Object.assign({}, product, {
      listings: product.listings.filter(listing =>
        getRelativePrice(listing) > (averagePrice / belowPriceFactorThreshold),
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
