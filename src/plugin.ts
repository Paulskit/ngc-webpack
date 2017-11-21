
import { NgcWebpackPluginOptions } from './plugin-options'
import { hasHook } from './utils';
import { WebpackResourceLoader } from './resource-loader';
import { NgcCompilerExecutionHost, MonkeyWebpackCompilerHost } from './execution-models';
import { createAngularCompilerPluginExecutionHost } from './angular-compiler-execution-host';


export class NgcWebpackPlugin {
  readonly ngcWebpackPluginOptions: NgcWebpackPluginOptions;
  private executionHostFactory: (options: NgcWebpackPluginOptions) => NgcCompilerExecutionHost;

  constructor(options: NgcWebpackPluginOptions,
              executionHostFactory: (options: NgcWebpackPluginOptions) => NgcCompilerExecutionHost = createAngularCompilerPluginExecutionHost) {
    if (options.hasOwnProperty('AOT')) {
      if (!options.hasOwnProperty('skipCodeGeneration')) {
        options.skipCodeGeneration = !options.AOT;
      }
      delete options.AOT;
    }

    this.ngcWebpackPluginOptions = options;
    this.executionHostFactory = executionHostFactory;
  }

  apply(compiler: any) {
    const ngcOptions = this.ngcWebpackPluginOptions;
    const executionHost = this.executionHostFactory(this.ngcWebpackPluginOptions);
    const compilerHost = executionHost.compilerHost;

    const executeHook = <K extends keyof NgcWebpackPluginOptions>(key: K, defaultHook: (opt: NgcWebpackPluginOptions[K]) => void) => {
      if (ngcOptions[key]) {
        if (executionHost.hookOverride && executionHost.hookOverride[key]) {
          executionHost.hookOverride[key](ngcOptions[key]);
        } else {
          defaultHook(ngcOptions[key]);
        }
      }
    };

    executeHook('beforeRun', beforeRun => {
      let ran = false;
      const run = (cmp, next) => {
        if (ran) {
          next();
          return;
        }
        // for now, run once
        // TODO: add hook for watch mode to notify on watch-run
        ran = true;
        const webpackResourceLoader = new WebpackResourceLoader();
        webpackResourceLoader.update(compiler.createCompilation());
        Promise.resolve(beforeRun(webpackResourceLoader)).then(next).catch(next);
      };
      compiler.plugin('run', run);
      compiler.plugin('watch-run', run);
    });

    executeHook('readFileTransformer', opt => {
      const orgReadFile = compilerHost.readFile;
      const { predicate, transform } = ngcOptions.readFileTransformer;
      const predicateFn = typeof predicate === 'function'
        ? predicate
        : (fileName: string) => predicate.test(fileName)
      ;

      Object.defineProperty(compilerHost, 'readFile', {
        value: function(this: MonkeyWebpackCompilerHost, fileName: string): string {
          const readFileResponse = orgReadFile.call(compilerHost, fileName);
          return predicateFn(fileName) ? transform(fileName, readFileResponse) : readFileResponse;
        }
      });
    });

    if (ngcOptions.tsTransformers) {
      if (ngcOptions.tsTransformers.before) {
        executionHost.transformers.push(...ngcOptions.tsTransformers.before);
      }
      if (ngcOptions.tsTransformers.after) {

      }
    }

    if (hasHook(ngcOptions, ['resourcePathTransformer', 'resourceTransformer']).some( v => v) ) {
      const resourceGet = compilerHost.resourceLoader.get;
      compilerHost.resourceLoader.get = (filePath: string): Promise<string> => {
        executeHook('resourcePathTransformer', pathTransformer => filePath = pathTransformer(filePath));

        let p = resourceGet.call(compilerHost.resourceLoader, filePath);

        executeHook(
          'resourceTransformer',
          resourceTransformer => p = p.then( content => Promise.resolve(resourceTransformer(filePath, content)) )
        );

        return p;
      }
    }

    executionHost.execute(compiler);
  }

  static clone(plugin: NgcWebpackPlugin,
               overwrite: {
                 options?: Partial<NgcWebpackPluginOptions>,
                 executionHostFactory?: (options: NgcWebpackPluginOptions) => NgcCompilerExecutionHost
               }): NgcWebpackPlugin {
    const options = Object.assign({}, plugin.ngcWebpackPluginOptions, overwrite.options || {});
    const executionHostFactory = overwrite.executionHostFactory || plugin.executionHostFactory;
    return new NgcWebpackPlugin(options, executionHostFactory);
  }
}