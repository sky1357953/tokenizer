import Utils from '../utils.js';
import { geom } from '../marching-squares.js';
import CONSTANTS from '../constants.js';

export default class Layer {
  constructor(width, height, color = null) {
    this.id = Utils.generateUUID();
    this.view = document.createElement('canvas');
    this.view.width = width;
    this.view.height = height;

    // the current position of the source image on the view canvas
    this.position = {
      x: 0,
      y: 0,
    };

    // the current scale, will be calculated once an image is loaded into the view canvas
    this.scale = 1;

    // the current degree of rotation
    this.rotation = 0;

    // canvas referencing to the source (image) that will be displayed on the view canvas
    this.source = null;
    // the image drawn on the source, kept for rotations
    this.sourceImg = null;

    // active layers allow mouse events to be followed (scale/translate)
    this.isActive = false;

    // controls the rendering of the layer: masked and by using which mask exactly?
    // source mask is the mask generated by the source image, and mask can be another mask
    // from another layer

    // indicates that this layer's mask is the one that is applied to all other layers
    this.providesMask = false;

    this.isMasked = false;
    this.sourceMask = null;
    this.mask = null;

    // initialize with color
    this.previousColor = null;
    this.color = null;
    this.setColor(color);

    this.alpha = 1.0;
    this.compositeOperation = CONSTANTS.BLEND_MODES.DEFAULT;
    this.visible = true;
  }

  /**
   * Activates the event listeners on the view canvas for scaling and translating
   */
  activate() {
    this.isActive = true;
  }

  /**
   * Deactivates the event listeners on the view canvas for scaling and translating (color picking is always active)
   */
  deactivate() {
    this.isActive = false;
  }

  /**
   * Creates a mask using the marching squares algorithm by walking the edges of the non-transparent pixels to find a contour.
   * Works naturally best for token images which have a circular ring-shape. The algorithm walks the contour and fills the inner regions with black, too
   * The mask is not active on creating, it is controlled by
   *
   * this.applyMask(mask | null), see above
   */
  createMask() {
    // create intermediate canvas
    let temp = document.createElement('canvas');
    // create a canvas that has at least a 1px transparent border all around
    // so the marching squares algorithm won't run endlessly
    temp.width = this.source.width + 2;
    temp.height = this.source.height + 2;
    temp.getContext('2d').drawImage(this.source, 1, 1, this.source.width, this.source.height);

    // get the pixel data from the source image
    let ctx = temp.getContext('2d');
    let pixels = ctx.getImageData(0, 0, this.source.width + 2, this.source.height + 2);

    const transparencyThreshold = 254;

    let completelyTransparent = () => {
      let pixels = this.source.getContext('2d').getImageData(0, 0, this.source.width, this.source.height).data;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] > transparencyThreshold) {
          return false;
        }
      }

      return true;
    };
    let completelyOpaque = () => {
      let pixels = this.source.getContext('2d').getImageData(0, 0, this.source.width, this.source.height).data;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] < transparencyThreshold) {
          return false;
        }
      }
      return true;
    };

    let isTransparent = (x, y) => {
      return transparencyThreshold < pixels.data[(((y * pixels.width) + x) * 4) + 3];
    };

    // re-use the intermediate canvas
    ctx.fillStyle = game.settings.get("vtta-tokenizer", "default-color");
    ctx.strokeStyle = '#000000AA';
    ctx.lineWidth = 1;

    // the mask is totally transparent
    if (completelyTransparent()) {
      ctx.clearRect(0, 0, temp.width, temp.height);
    } else {
      // eslint-disable-next-line no-lonely-if
      if (completelyOpaque()) {
        ctx.clearRect(0, 0, temp.width, temp.height);
        ctx.fillRect(0, 0, temp.width, temp.height);
        ctx.fill();
      } else {
        // process the pixel data
        var points = geom.contour(isTransparent);
        ctx.clearRect(0, 0, temp.width, temp.height);
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][4]);
        for (var i = 1; i < points.length; i++) {
          var point = points[i];
          ctx.lineTo(point[0], point[1]);
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    // clip the canvas
    this.sourceMask = document.createElement('canvas');
    this.sourceMask.width = this.source.width;
    this.sourceMask.height = this.source.height;
    this.sourceMask
      .getContext('2d')
      .drawImage(temp, 1, 1, this.source.width, this.source.height, 0, 0, this.source.width, this.source.height);
  }

  /**
   * Sets the mask for this image to an existing, foreign mask or to the sourceMask, which is already generated
   * @param {canvas} mask Canvas or null. If set to null, the sourceMask is used for masking, otherwise a given mask
   */
  applyMask(mask = null) {
    if (mask === null) {
      this.mask = this.sourceMask;
    } else {
      this.mask = mask;
    }
    this.isMasked = true;
    this.redraw();
  }

  /**
   * Removes the application of the current set mask, but does not delete said mask from the object
   */
  unapplyMask() {
    this.isMasked = false;
    this.redraw();
  }

  /**
   * Loads an image on the source canvas and centers it on the view canvas
   */
  fromImage(img) {
    // create a new canvas element for the new source
    this.sourceImg = img;
    this.source = document.createElement('canvas');

    // set dimensions to the image's natural dimensions
    this.source.width = img.naturalWidth;
    this.source.height = img.naturalHeight;

    this.reset();

    // draw the image on the source
    this.source.getContext('2d').drawImage(img, 0, 0, this.source.width, this.source.height);

    // create a mask for it in advance
    this.createMask();

    // redraw the canvas
    this.redraw();
  }

  /**
   * Sets the background color for this layer. It will be masked, too
   * @param {color} hexColorString
   */
  setColor(hexColorString = null) {
    this.color = hexColorString;
    this.redraw();
  }

  saveColor() {
    this.previousColor = this.color;
  }

  restoreColor() {
    this.color = this.previousColor;
  }

  reset() {
    this.scale = this.width / Math.max(this.source.width, this.source.height);

    this.rotation = 0;

    // set initial position: x
    this.position.x = Math.floor((this.width / 2) - ((this.source.width * this.scale) / 2));

    // set initial position: y
    this.position.y = Math.floor((this.height / 2) - ((this.source.height * this.scale) / 2));
    this.redraw();
  }

  /**
   * Gets the width of the view canvas
   */
  get width() {
    return this.view.width;
  }

  /**
   * Gets the height of the view canvas
   */
  get height() {
    return this.view.height;
  }

  /**
   * Translates the source on the view canvas
   * @param {Number} dx translation on the x-axis
   * @param {Number} dy translation on the y-axis
   */
  translate(dx, dy) {
    this.position.x -= dx;
    this.position.y -= dy;
    this.redraw();
  }

  /**
   * Scales the source on the view canvas according to a given factor
   * @param {Number} factor
   */
  setScale(factor) {
    this.scale = factor;
    this.redraw();
  }

  rotate(degree) {
    this.rotation += degree * 2;
  }

  /**
   * Refreshes the view canvas with the background color and/or the source image
   */
  redraw() {
    let ctx = this.view.getContext('2d');
    ctx.clearRect(0, 0, this.width, this.height);

    // is a background color set?
    if (this.color !== null) {
      ctx.fillStyle = this.color;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    var TO_RADIANS = Math.PI / 180;

    function drawRotatedImage(canvas, image, x, y, angle) {
      let context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      // save the current co-ordinate system
      // before we screw with it
      context.save();

      // move to the middle of where we want to draw our image
      context.translate(x, y);

      // rotate around that point, converting our
      // angle from degrees to radians
      context.rotate(angle * TO_RADIANS);

      // draw it up and to the left by half the width
      // and height of the image
      context.drawImage(image, -(image.width / 2), -(image.height / 2));

      // and restore the co-ords to how they were when we began
      context.restore();
    }

    // draw the source
    if (this.source !== null) {
      drawRotatedImage(
        this.source,
        this.sourceImg,
        Math.round(this.sourceImg.naturalWidth / 2),
        Math.round(this.sourceImg.naturalHeight / 2),
        this.rotation
      );
      let ctx = this.view.getContext('2d');
      // ctx.clearRect(0, 0, this.width, this.height);
      ctx.drawImage(
        this.source,
        this.position.x,
        this.position.y,
        this.source.width * this.scale,
        this.source.height * this.scale
      );
    }
  }
}
