import { createReadStream, createWriteStream } from 'fs';
import _ from 'lodash';
import { createInterface } from 'readline';


const PRODUCTS_FILE = 'products.txt';
const LISTINGS_FILE = 'listings.txt';
const RESULTS_FILE = 'results.txt';

const productsLineReader = createInterface({
  input: createReadStream(PRODUCTS_FILE),
});
const listingsLineReader = createInterface({
  input: createReadStream(LISTINGS_FILE),
});
const resultsWriteStream = createWriteStream(RESULTS_FILE);

let products = [];
let listings = [];

let productsLineReaderIsClosed = false;
let listingsLineReaderIsClosed = false;


productsLineReader.on('line', line => products.push(JSON.parse(line)));
listingsLineReader.on('line', line => listings.push(JSON.parse(line)));

productsLineReader.on('close', () => {
  productsLineReaderIsClosed = true;
  if (listingsLineReaderIsClosed) onDataLoaded();
});

listingsLineReader.on('close', () => {
  listingsLineReaderIsClosed = true;
  if (productsLineReaderIsClosed) onDataLoaded();
});


function onDataLoaded() {
  products.forEach(product => product.listings = []);

  firstPass();

  products.forEach(product => {
    resultsWriteStream.write(`${JSON.stringify(
      _.pick(product, 'product_name', 'listings')
    )}\n`);
  });
}

function firstPass() {
  listings.forEach(listing => {
    products.forEach(product => {
      const productManufacturerRegex =
        new RegExp(`^${product.manufacturer}$`, 'i');
      const productModelRegex = new RegExp(product.model, 'i');
      const productFamilyRegex = new RegExp(product.family || '', 'i');

      if (productManufacturerRegex.test(listing.manufacturer)
        && productModelRegex.test(listing.title)
        && productFamilyRegex.test(listing.title)) {
        product.listings.push(listing);
      }
    });
  });
}
