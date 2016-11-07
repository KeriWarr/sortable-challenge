import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const PRODUCTS_FILE = 'products.txt';
const LISTINGS_FILE = 'listings.txt';

const productsLineReader = createInterface({
  input: createReadStream(PRODUCTS_FILE),
});
const listingsLineReader = createInterface({
  input: createReadStream(LISTINGS_FILE),
});

let products = [];
let listings = [];

let productsLineReaderIsClosed = false;
let listingsLineReaderIsClosed = false;

productsLineReader.on('line', line => products.push(JSON.parse(line)));
listingsLineReader.on('line', line => listings.push(JSON.parse(line)));

productsLineReader.on('close', () => {
  productsLineReaderIsClosed = true;
  if (listingsLineReaderIsClosed) dataIsLoaded();
});

listingsLineReader.on('close', () => {
  listingsLineReaderIsClosed = true;
  if (productsLineReaderIsClosed) dataIsLoaded();
});

function dataIsLoaded() {
  products.forEach(product => product.listings = []);

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

  console.log(JSON.stringify(products.slice(100), null, 2));
}
