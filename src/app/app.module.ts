import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';

import { AppComponent } from './app.component';
import { StarlinkVisualizerComponent } from './components/starlink-visualizer/starlink-visualizer.component';

@NgModule({
  declarations: [
    AppComponent,
    StarlinkVisualizerComponent
  ],
  imports: [
    BrowserModule,
    FormsModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule {}
